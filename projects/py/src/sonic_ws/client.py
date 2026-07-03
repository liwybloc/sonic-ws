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
from websockets.asyncio.client import connect
from .connection import Connection, PacketHolder, dispatch_packet
from .codec import inflate
from .packets import Packet, read_varint, flatten_data, unflatten_data
from .enums import wrap_enum, dewrap_enum

VERSION = 23


class SonicWS(Connection):
    def __init__(self, socket):
        super().__init__(socket)
        self.client_packets = PacketHolder()
        self.server_packets = PacketHolder()
        self._ready = asyncio.get_running_loop().create_future()
        self._pre_listeners = []

    @classmethod
    async def connect(cls, url, **kwargs):
        self = cls(await connect(url, **kwargs))
        self._reader = asyncio.create_task(self._run())
        await self._ready
        return self

    async def _run(self):
        try:
            first = bytes(await self.socket.recv())
            if first[:3] != b"SWS" or len(first) < 4:
                raise ValueError("server is not a SonicWS server")
            if first[3] != VERSION:
                raise ValueError(f"SonicWS version mismatch: {first[3]} != {VERSION}")
            data = inflate(first[4:])
            offset, self.id = read_varint(data)
            offset, length = read_varint(data, offset)
            client_blob = data[offset : offset + length]
            server_blob = data[offset + length :]
            self.client_packets = PacketHolder(self._deserialize_all(client_blob, True))
            self.server_packets = PacketHolder(self._deserialize_all(server_blob, True))
            if not self._ready.done():
                self._ready.set_result(None)
            await self._middleware("onStatusChange", 1)
            async for message in self.socket:
                raw = bytes(message)
                if not raw:
                    continue
                await self._emit("__raw_message__", raw, False)
                if raw[0] == 0 or raw[0] > len(self.server_packets.packets):
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
                    raise ValueError(f'{tag}: {error}') from error
        except Exception as error:
            if not self._ready.done():
                self._ready.set_exception(error)
            else:
                raise
        finally:
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

    async def send_safe(self, tag, *values):
        try:
            await self.send(tag, *values)
            return True
        except Exception:
            import logging
            logging.getLogger(__name__).exception('Failed to send packet "%s"', tag)
            return False

    async def wait_ready(self):
        await self._ready

    def on_ready(self, listener):
        if self._ready.done() and self._ready.exception() is None:
            asyncio.create_task(_invoke(listener))
        elif not self._ready.done():
            asyncio.create_task(_ready_call(self._ready, listener))

    WrapEnum = staticmethod(
        wrap_enum
    )
    DeWrapEnum = staticmethod(dewrap_enum)
    FlattenData = staticmethod(flatten_data)
    UnFlattenData = staticmethod(unflatten_data)
    onReady = on_ready
    waitReady = wait_ready
    sendVariant = send_variant
    sendSafe = send_safe


async def _invoke(callback):
    result = callback()
    if asyncio.iscoroutine(result):
        await result


async def _ready_call(event, callback):
    await event
    await _invoke(callback)
