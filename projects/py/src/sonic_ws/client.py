# Copyright (c) 2026 Lily (liwybloc)
#
# Licensed for personal, non-commercial use only.
# Commercial use, redistribution, sublicensing, sale, rental, lease,
# or inclusion in a paid product or service is prohibited without prior
# written permission from the copyright holder.
#
# See the LICENSE file in the project root for the full license terms.
#
# License-Identifier: LicenseRef-Lily-Personal-NonCommercial-2026

import asyncio
import math
import random
from websockets.asyncio.client import connect
from .connection import Connection, PacketHolder, dispatch_packet
from .codec import inflate
from .packets import Packet, read_varint, flatten_data, unflatten_data
from .enums import wrap_enum, dewrap_enum
from .control import (
    HEARTBEAT,
    REQUEST,
    RESPONSE,
    REPLAY,
    RESUME,
    RESUMED,
    decode_control,
    encode_request,
    encode_response,
    encode_resume,
)
from .version import VERSION


class SonicWS(Connection):
    """Provides an asynchronous Python client for the SonicWS protocol."""

    def __init__(self, socket, *, url=None, connect_options=None, reconnect=None):
        super().__init__(socket)
        self.client_packets = PacketHolder()
        self.server_packets = PacketHolder()
        self._ready = asyncio.get_running_loop().create_future()
        self._pre_listeners = []
        self._next_request_id = 1
        self._pending_requests = {}
        self._responders = {}
        self._url = url
        self._connect_options = connect_options or {}
        reconnect = (
            reconnect if isinstance(reconnect, dict) else {"enabled": bool(reconnect)}
        )
        self._reconnect = {
            "enabled": reconnect.get("enabled", False),
            "attempts": reconnect.get("attempts", math.inf),
            "min_delay": reconnect.get("minDelayMs", reconnect.get("min_delay_ms", 500))
            / 1000,
            "max_delay": reconnect.get(
                "maxDelayMs", reconnect.get("max_delay_ms", 10_000)
            )
            / 1000,
            "jitter": reconnect.get("jitter", 0.25),
        }
        self._intentional_close = False
        self._connected_once = False
        self._reconnect_attempt = 0
        self._reconnect_pending = False
        self.session_id = None
        self.last_replay_sequence = 0
        self.last_disconnect_error = None
        self._pending_resume_session = None

    @classmethod
    async def connect(
        cls, url, reconnect=None, ready_timeout=10.0, ready_timeout_ms=None, **kwargs
    ):
        if ready_timeout_ms is not None:
            ready_timeout = ready_timeout_ms / 1000
        self = cls(
            await connect(url, **kwargs),
            url=url,
            connect_options=kwargs,
            reconnect=reconnect,
        )
        self._reader = asyncio.create_task(self._run())
        try:
            await asyncio.wait_for(asyncio.shield(self._ready), ready_timeout)
        except asyncio.TimeoutError as error:
            await self.close(4004, "SonicWS schema handshake timed out")
            raise TimeoutError("SonicWS schema handshake timed out") from error
        return self

    async def _run(self):
        while True:
            try:
                await self._run_transport()
            except Exception as error:
                self.last_disconnect_error = error
                if not self._ready.done():
                    self._ready.set_exception(error)
                    break
            code = getattr(self.socket, "close_code", 1006) or 1006
            reason = getattr(self.socket, "close_reason", "") or ""
            if (
                self._intentional_close
                or code == 1000
                or not self._reconnect["enabled"]
            ):
                break
            await self._emit("__close__", [code, reason])
            await self._middleware("onStatusChange", 3)
            reconnected = False
            while not reconnected:
                if self._reconnect_attempt >= self._reconnect["attempts"]:
                    await self._emit("__reconnect_failed__", None, False)
                    break
                self._reconnect_attempt += 1
                base = min(
                    self._reconnect["max_delay"],
                    self._reconnect["min_delay"] * (2 ** (self._reconnect_attempt - 1)),
                )
                spread = base * self._reconnect["jitter"]
                delay = max(0, base - spread + random.random() * spread * 2)
                await self._emit(
                    "__reconnecting__",
                    {
                        "attempt": self._reconnect_attempt,
                        "delayMs": round(delay * 1000),
                    },
                    False,
                )
                await asyncio.sleep(delay)
                try:
                    self.socket = await connect(self._url, **self._connect_options)
                    self._closed = False
                    self.client_packets = PacketHolder()
                    self.server_packets = PacketHolder()
                    self._reconnect_pending = True
                    reconnected = True
                except Exception:
                    pass
            if not reconnected:
                break

        for packet in self.client_packets.packets:
            packet.quantization_errors.pop(0, None)
        if not self._ready.done():
            self._ready.set_exception(
                ConnectionError("connection closed before the SonicWS handshake")
            )
        await self._shutdown(
            getattr(self.socket, "close_code", 1000) or 1000,
            getattr(self.socket, "close_reason", "") or "",
        )

    async def _run_transport(self):
        try:
            first = bytes(await self.socket.recv())
            if first[:3] != b"SWS" or len(first) < 4:
                raise ValueError("server is not a SonicWS server")
            if first[3] != VERSION:
                raise ValueError(f"SonicWS version mismatch: {first[3]} != {VERSION}")
            data = inflate(first[4:])
            previous_session = self.session_id
            offset, self.id = read_varint(data)
            offset, session_length = read_varint(data, offset)
            self.session_id = data[offset : offset + session_length].decode()
            offset += session_length
            offset, length = read_varint(data, offset)
            client_blob = data[offset : offset + length]
            server_blob = data[offset + length :]
            self.client_packets = PacketHolder(self._deserialize_all(client_blob, True))
            self.server_packets = PacketHolder(self._deserialize_all(server_blob, True))
            if not self._ready.done():
                self._ready.set_result(None)
            if self._reconnect_pending:
                if previous_session:
                    self._pending_resume_session = previous_session
                    await self.raw_send(
                        encode_resume(previous_session, self.last_replay_sequence)
                    )
                self._reconnect_pending = False
                self._reconnect_attempt = 0
                self.last_disconnect_error = None
                await self._emit("__reconnect__", None, False)
            self._connected_once = True
            await self._middleware("onStatusChange", 1)
            async for message in self.socket:
                raw = bytes(message)
                if not raw:
                    continue
                await self._emit("__raw_message__", raw, False)
                if raw[0] == 0:
                    await self._handle_control(raw)
                    continue
                if raw[0] > len(self.server_packets.packets):
                    raise ValueError(f"invalid packet key {raw[0]}")
                tag = self.server_packets.tag(raw[0])
                packet = self.server_packets.packet(tag)
                if await self._middleware("onReceive_pre", tag, raw[1:], len(raw) - 1):
                    continue
                try:
                    operation = dispatch_packet(self, packet, raw[1:])
                    if packet.asynchronous:
                        task = asyncio.create_task(operation)
                        self._tasks.add(task)
                        task.add_done_callback(self._async_receive_done)
                    else:
                        await operation
                except Exception as error:
                    raise ValueError(f"{tag}: {error}") from error
        except Exception as error:
            raise error

    def _async_receive_done(self, task):
        self._tasks.discard(task)
        if task.cancelled():
            return
        error = task.exception()
        if error and not self._closed:
            asyncio.create_task(self.close(4003, str(error)))

    @staticmethod
    def _deserialize_all(data, client):
        result = []
        offset = 0
        while offset < len(data):
            packet, length = Packet.deserialize(data, offset, client)
            result.append(packet)
            offset += length
        return result

    async def send(self, tag, *values):
        async with self._send_lock:
            if await self._middleware("onSend_pre", tag, list(values), 0, 0):
                return
            tag = self.client_packets.resolve(tag)
            packet = self.client_packets.packet(tag)
            code = self.client_packets.code(tag)
            if packet.rereference and packet.last_sent.get(0) == values:
                data = b""
            else:
                data = packet.encode(values, 0)
                packet.last_sent[0] = values
            if packet.data_batching:
                await self._batch(code, packet, data)
            else:
                await self.raw_send(bytes([code]) + data)
            await self._middleware("onSend_post", tag, data, len(data))

    async def send_variant(self, parent, variant, *values):
        await self.send(self.client_packets.variant_tag(parent, variant), *values)

    async def send_permutation(self, parent, selection, *values):
        await self.send(self.client_packets.permutation_tag(parent, selection), *values)

    async def request(self, tag, *values, timeout=5.0):
        tag = self.client_packets.resolve(tag)
        packet = self.client_packets.packet(tag)
        payload = packet.encode(values, 0)
        identifier = self._next_request_id
        self._next_request_id = 1 if identifier >= 0x7FFFFFFF else identifier + 1
        future = asyncio.get_running_loop().create_future()
        self._pending_requests[identifier] = future
        await self.raw_send(
            encode_request(identifier, self.client_packets.code(tag), payload)
        )
        try:
            return await asyncio.wait_for(future, timeout)
        except asyncio.TimeoutError as error:
            raise TimeoutError(f'RPC request "{tag}" timed out') from error
        finally:
            self._pending_requests.pop(identifier, None)

    def respond(self, tag, handler):
        self._responders[self.server_packets.resolve(tag)] = handler

    async def _handle_control(self, raw):
        try:
            message = decode_control(raw)
        except ValueError:
            await self.close(4004, "malformed SonicWS control frame")
            return
        if message[0] == REPLAY:
            _, sequence, payload = message
            if sequence <= self.last_replay_sequence:
                return
            self.last_replay_sequence = sequence
            if (
                not payload
                or payload[0] == 0
                or payload[0] > len(self.server_packets.packets)
            ):
                raise ValueError("invalid replayed packet")
            tag = self.server_packets.tag(payload[0])
            await dispatch_packet(self, self.server_packets.packet(tag), payload[1:])
            return
        if message[0] == HEARTBEAT:
            await self.raw_send(bytes([0]))
            return
        if message[0] == RESUMED:
            _, recovered, replayed = message
            if recovered and self._pending_resume_session:
                self.session_id = self._pending_resume_session
            self._pending_resume_session = None
            if not recovered:
                self.last_replay_sequence = 0
            await self._emit(
                "__recovered__", {"recovered": recovered, "replayed": replayed}, False
            )
            return
        if message[0] == RESUME:
            raise ValueError("a client cannot receive a recovery request")
        if message[0] == RESPONSE:
            _, identifier, ok, value = message
            future = self._pending_requests.get(identifier)
            if future and not future.done():
                if ok:
                    future.set_result(value)
                else:
                    future.set_exception(RuntimeError(str(value)))
            return
        _, identifier, key, payload = message
        try:
            tag = self.server_packets.tag(key)
            handler = self._responders.get(tag)
            if handler is None:
                raise ValueError(f'No responder registered for packet "{tag}"')
            packet = self.server_packets.packet(tag)
            value = packet.decode(payload)
            args = (
                value
                if isinstance(value, list)
                and not packet.dont_spread
                and not packet.schema
                else [value]
            )
            if packet.validator:
                valid = packet.validator(None, *args)
                if asyncio.iscoroutine(valid):
                    valid = await valid
                if not valid:
                    raise ValueError("custom packet validation failed")
            result = handler(*args)
            if asyncio.iscoroutine(result):
                result = await result
            await self.raw_send(encode_response(identifier, True, result))
        except Exception as error:
            await self.raw_send(encode_response(identifier, False, str(error)))

    async def send_safe(self, tag, *values):
        try:
            await self.send(tag, *values)
            return True
        except Exception:
            import logging

            logging.getLogger(__name__).exception('Failed to send packet "%s"', tag)
            return False

    async def send_volatile(self, tag, *values):
        if not self.can_send_volatile():
            return False
        await self.send(tag, *values)
        return True

    async def send_reliable(self, tag, *values):
        await self.send(tag, *values)

    async def wait_ready(self):
        await self._ready

    def on_ready(self, listener):
        if self._ready.done() and self._ready.exception() is None:
            asyncio.create_task(_invoke(listener))
        elif not self._ready.done():
            asyncio.create_task(_ready_call(self._ready, listener))

    def on_reconnecting(self, listener):
        return self.on("__reconnecting__", listener)

    def on_reconnect(self, listener):
        return self.on("__reconnect__", listener)

    def on_reconnect_failed(self, listener):
        return self.on("__reconnect_failed__", listener)

    def on_recovered(self, listener):
        return self.on("__recovered__", listener)

    async def close(self, code=1000, reason=""):
        self._intentional_close = True
        await super().close(code, reason)

    WrapEnum = staticmethod(wrap_enum)
    DeWrapEnum = staticmethod(dewrap_enum)
    FlattenData = staticmethod(flatten_data)
    UnFlattenData = staticmethod(unflatten_data)
    onReady = on_ready
    waitReady = wait_ready
    sendVariant = send_variant
    sendPermutation = send_permutation
    sendSafe = send_safe
    sendVolatile = send_volatile
    sendReliable = send_reliable
    onReconnecting = on_reconnecting
    onReconnect = on_reconnect
    onReconnectFailed = on_reconnect_failed
    onRecovered = on_recovered


async def _invoke(callback):
    result = callback()
    if asyncio.iscoroutine(result):
        await result


async def _ready_call(event, callback):
    await event
    await _invoke(callback)
