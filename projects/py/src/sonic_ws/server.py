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
import inspect
import logging
import time
import uuid
from websockets.asyncio.server import serve
from websockets.exceptions import ConnectionClosed
from .connection import Connection, PacketHolder, CloseCodes, dispatch_packet
from .codec import deflate
from .packets import varint, flatten_data
from .middleware import BCInfo
from .control import (
    REQUEST,
    RESPONSE,
    REPLAY,
    RESUME,
    RESUMED,
    decode_control,
    encode_request,
    encode_response,
    encode_replay,
    encode_resumed,
)
from .version import VERSION

MAX_USHORT = 65_535
logger = logging.getLogger(__name__)


def _rate_limit(value):
    value = int(value)
    if value < 0:
        raise ValueError("rate limit cannot be negative")
    return 0 if value > MAX_USHORT else value


class SonicWSConnection(Connection):
    """Represents one accepted server-side SonicWS connection."""

    def __init__(self, socket, host, identifier, session_id, state):
        super().__init__(socket, identifier, f"Socket {identifier}")
        self.host = host
        self.handshake_complete = host.handshake_packet is None
        self.enabled = {p.tag: p.default_enabled for p in host.client_packets.packets}
        self.tags = set()
        self.session_id = session_id
        self.state = state
        self._next_request_id = 1
        self._pending_requests = {}
        self._responders = {}
        self.upgrade_request = getattr(socket, "request", None)

    async def run(self):
        handshake_timer = None
        if not self.handshake_complete:

            async def expire_handshake():
                await asyncio.sleep(self.host.handshake_timeout)
                if not self.handshake_complete:
                    await self.close(
                        CloseCodes.INVALID_DATA, "application handshake timed out"
                    )

            handshake_timer = asyncio.create_task(expire_handshake())
        try:
            async for message in self.socket:
                raw = bytes(message)
                await self._emit("__raw_message__", raw, False)
                if not raw:
                    await self.close(CloseCodes.SMALL, "empty packet")
                    return
                if raw[0] == 0:
                    await self._handle_control(raw)
                    continue
                if raw[0] > len(self.host.client_packets.packets):
                    await self.close(CloseCodes.INVALID_KEY, "invalid packet key")
                    return
                tag = self.host.client_packets.tag(raw[0])
                packet = self.host.client_packets.packet(tag)
                if not self._within_rate(
                    "client", self.host.client_rate_limit
                ) or not self._within_rate("client:" + tag, packet.rate_limit):
                    await self.close(CloseCodes.RATELIMIT, "rate limit exceeded")
                    return
                if not self.enabled[tag]:
                    await self.close(CloseCodes.DISABLED_PACKET, "disabled packet")
                    return
                if not self.handshake_complete:
                    if tag != self.host.handshake_packet:
                        await self.close(CloseCodes.INVALID_DATA, "handshake required")
                        return
                    self.handshake_complete = True
                elif tag == self.host.handshake_packet:
                    await self.close(
                        CloseCodes.REPEATED_HANDSHAKE, "repeated handshake"
                    )
                    return
                try:
                    if not await self._middleware(
                        "onReceive_pre", tag, raw[1:], len(raw) - 1
                    ):
                        operation = dispatch_packet(self, packet, raw[1:], self)
                        if packet.asynchronous:
                            task = asyncio.create_task(operation)
                            self._tasks.add(task)
                            task.add_done_callback(self._async_receive_done)
                        else:
                            await operation
                except Exception as error:
                    await self.close(
                        CloseCodes.INVALID_PACKET,
                        f"{tag}: {error}",
                    )
                    return
        except ConnectionClosed:
            pass
        finally:
            if handshake_timer:
                handshake_timer.cancel()
            for packet in self.host.server_packets.packets:
                packet.quantization_errors.pop(self.id, None)
            code = getattr(self.socket, "close_code", 1000) or 1000
            reason = getattr(self.socket, "close_reason", "") or ""
            await self._shutdown(code, reason)
            await self.host._middleware("onClientDisconnect", self, code, reason)
            self.host._remove(self)

    def _async_receive_done(self, task):
        self._tasks.discard(task)
        if task.cancelled():
            return
        error = task.exception()
        if error and not self._closed:
            asyncio.create_task(self.close(CloseCodes.INVALID_PACKET, str(error)))

    async def send(self, tag, *values):
        async with self._send_lock:
            if await self._middleware(
                "onSend_pre",
                tag,
                list(values),
                int(time.time() * 1000),
                time.perf_counter() * 1000,
            ):
                return
            tag = self.host.server_packets.resolve(tag)
            packet = self.host.server_packets.packet(tag)
            code = self.host.server_packets.code(tag)
            if packet.rereference and packet.last_sent.get(self.id) == values:
                data = b""
            else:
                data = packet.encode(values, self.id)
                packet.last_sent[self.id] = values
            if await self._middleware("onSend_post", tag, data, len(data)):
                return
            await self.send_processed(code, data, packet)

    async def send_variant(self, parent, variant, *values):
        await self.send(self.host.server_packets.variant_tag(parent, variant), *values)

    async def send_permutation(self, parent, selection, *values):
        await self.send(self.host.server_packets.permutation_tag(parent, selection), *values)

    async def request(self, tag, *values, timeout=5.0):
        tag = self.host.server_packets.resolve(tag)
        packet = self.host.server_packets.packet(tag)
        if not self._within_rate(
            "server", self.host.server_rate_limit
        ) or not self._within_rate("server:" + tag, packet.rate_limit):
            raise ValueError(f'Packet "{tag}" exceeded its rate limit')
        payload = packet.encode(values, self.id)
        identifier = self._next_request_id
        self._next_request_id = 1 if identifier >= 0x7FFFFFFF else identifier + 1
        future = asyncio.get_running_loop().create_future()
        self._pending_requests[identifier] = future
        await self.raw_send(
            encode_request(identifier, self.host.server_packets.code(tag), payload)
        )
        try:
            return await asyncio.wait_for(future, timeout)
        except asyncio.TimeoutError as error:
            raise TimeoutError(f'RPC request "{tag}" timed out') from error
        finally:
            self._pending_requests.pop(identifier, None)

    def respond(self, tag, handler):
        self._responders[self.host.client_packets.resolve(tag)] = handler

    async def _handle_control(self, raw):
        if not self._within_rate("client", self.host.client_rate_limit):
            await self.close(CloseCodes.RATELIMIT, "rate limit exceeded")
            return
        try:
            message = decode_control(raw)
        except ValueError:
            await self.close(CloseCodes.INVALID_DATA, "malformed SonicWS control frame")
            return
        if message[0] == RESUME:
            await self.host.resume_session(self, message[1], message[2])
            return
        if not self.handshake_complete:
            await self.close(
                CloseCodes.INVALID_DATA, "handshake required before control requests"
            )
            return
        if message[0] in (REPLAY, RESUMED):
            raise ValueError("a server cannot receive replay delivery frames")
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
            tag = self.host.client_packets.tag(key)
            packet = self.host.client_packets.packet(tag)
            if not self.enabled[tag]:
                await self.close(
                    CloseCodes.DISABLED_PACKET, f'Packet "{tag}" is disabled'
                )
                return
            if not self._within_rate("client:" + tag, packet.rate_limit):
                await self.close(
                    CloseCodes.RATELIMIT, f'Packet "{tag}" exceeded its rate limit'
                )
                return
            if await self._middleware("onReceive_pre", tag, payload, len(payload)):
                raise ValueError(f'Packet "{tag}" was rejected by middleware')
            handler = self._responders.get(tag)
            if handler is None:
                raise ValueError(f'No responder registered for packet "{tag}"')
            value = packet.decode(payload)
            args = (
                value
                if isinstance(value, list)
                and not packet.dont_spread
                and not packet.schema
                else [value]
            )
            if packet.validator:
                valid = packet.validator(self, *args)
                if inspect.isawaitable(valid):
                    valid = await valid
                if not valid:
                    raise ValueError("custom packet validation failed")
            result = handler(*args)
            if inspect.isawaitable(result):
                result = await result
            await self.raw_send(encode_response(identifier, True, result))
        except Exception as error:
            await self.raw_send(encode_response(identifier, False, str(error)))

    async def send_safe(self, tag, *values):
        try:
            await self.send(tag, *values)
            return True
        except Exception as error:
            self.host.handle_send_error(error, {"packetTag": tag, "connection": self})
            return False

    async def send_volatile(self, tag, *values):
        if not self.can_send_volatile():
            return False
        await self.send(tag, *values)
        return True

    async def send_reliable(self, tag, *values):
        await self.send(tag, *values)

    async def send_processed(self, code, data, packet):
        if not self._within_rate(
            "server", self.host.server_rate_limit
        ) or not self._within_rate("server:" + packet.tag, packet.rate_limit):
            return
        if packet.data_batching:
            await self._batch(code, packet, data)
        else:
            frame = bytes([code]) + data
            await self.raw_send(
                self.host.replay_frame(self, frame) if packet.replay else frame
            )

    async def broadcast(self, tag, *values):
        await self.host.broadcast_filtered(tag, lambda c: c is not self, *values)

    async def broadcast_filtered(self, tag, predicate, *values):
        await self.host.broadcast_filtered(
            tag,
            lambda connection: connection is not self and predicate(connection),
            *values,
        )

    def join(self, room):
        self.host.join(self, room)

    def leave(self, room):
        self.host.leave(self, room)

    async def broadcast_room(self, room, tag, *values):
        await self.host.broadcast_room_except(self, room, tag, *values)

    def enable_packet(self, tag):
        self.enabled[tag] = True

    def disable_packet(self, tag):
        self.enabled[tag] = False

    def tag(self, value, replace=True):
        self.host.tag(self, value, replace)

    def toggle_print(self):
        self.print_packets = not getattr(self, "print_packets", False)

    enablePacket = enable_packet
    disablePacket = disable_packet
    sendProcessed = send_processed
    broadcastFiltered = broadcast_filtered
    togglePrint = toggle_print
    sendVariant = send_variant
    sendPermutation = send_permutation
    sendSafe = send_safe
    sendVolatile = send_volatile
    sendReliable = send_reliable


class SonicWSServer:
    def __init__(
        self,
        settings=None,
        client_packets=(),
        server_packets=(),
        host="127.0.0.1",
        port=0,
        adapter=None,
        recovery=None,
        **kwargs,
    ):
        if isinstance(settings, dict):
            client_packets = settings.get(
                "clientPackets", settings.get("client_packets", client_packets)
            )
            server_packets = settings.get(
                "serverPackets", settings.get("server_packets", server_packets)
            )
            options = dict(settings.get("websocketOptions", {}))
            host = options.pop("host", host)
            port = options.pop("port", port)
            kwargs = {**options, **kwargs}
            self.on_send_error = settings.get(
                "onSendError", settings.get("on_send_error")
            )
            self.adapter = settings.get("adapter", adapter)
            recovery = settings.get("recovery", recovery or {})
            sonic_settings = settings.get(
                "sonicServerSettings", settings.get("sonic_server_settings", {})
            )
        else:
            self.on_send_error = None
            self.adapter = adapter
            recovery = recovery or {}
            sonic_settings = {}
        self.client_packets = PacketHolder(client_packets)
        self.server_packets = PacketHolder(server_packets)
        self.host = host
        self.port = port
        kwargs.setdefault("max_size", 8 * 1024 * 1024)
        self.websocket_options = kwargs
        self.handshake_timeout = (
            sonic_settings.get(
                "handshakeTimeoutMs", sonic_settings.get("handshake_timeout_ms", 10_000)
            )
            / 1000
        )
        if self.handshake_timeout <= 0:
            raise ValueError("handshake timeout must be positive")
        self.connections = []
        self.connection_map = {}
        self.connect_listeners = []
        self.recovered_listeners = []
        self.ready_listeners = []
        self.handshake_packet = None
        self._next_id = 1
        self._available_ids = []
        self._server = None
        self.client_rate_limit = 500
        self.server_rate_limit = 500
        self._middlewares = []
        self.debug_server = None
        self.server_id = str(uuid.uuid4())
        self.recovery_max_disconnection = (
            recovery.get(
                "maxDisconnectionMs", recovery.get("max_disconnection_ms", 120_000)
            )
            / 1000
        )
        self.recovery_max_packets = int(
            recovery.get("maxPackets", recovery.get("max_packets", 1_000))
        )
        self.recovery_authorize = recovery.get("authorize")
        if self.recovery_max_disconnection < 0 or self.recovery_max_packets < 0:
            raise ValueError("recovery limits cannot be negative")
        self.sessions = {}

    async def _adapter_call(self, name, *args):
        if self.adapter is None:
            return None
        callback = getattr(self.adapter, name, None)
        if callback is None:
            return None
        result = callback(*args)
        if inspect.isawaitable(result):
            return await result
        return result

    def _adapter_background(self, name, *args):
        if self.adapter is not None:
            asyncio.create_task(self._adapter_call(name, *args))

    def add_middleware(self, middleware):
        self._middlewares.append(middleware)
        callback = getattr(middleware, "init", None)
        if callback:
            try:
                result = callback(self)
                if inspect.isawaitable(result):
                    asyncio.create_task(result)
            except Exception:
                logger.exception("Middleware init raised an exception")

    async def _middleware(self, name, *args):
        cancelled = False
        for middleware in self._middlewares:
            callback = getattr(middleware, name, None)
            if callback:
                try:
                    result = callback(*args)
                    if inspect.isawaitable(result):
                        result = await result
                    cancelled = cancelled or bool(result)
                except Exception:
                    logger.exception("Middleware %s raised an exception", name)
        return cancelled

    async def call_middleware(self, name, *args):
        return await self._middleware(name, *args)

    async def start(self):
        await self._adapter_call(
            "start", self.server_id, self._receive_adapter_broadcast
        )
        self._server = await serve(
            self._accept,
            self.host,
            self.port,
            **self.websocket_options,
        )
        if self._server.sockets:
            self.port = self._server.sockets[0].getsockname()[1]
        for callback in self.ready_listeners:
            result = callback()
            if asyncio.iscoroutine(result):
                await result
        return self

    async def _accept(self, socket):
        if self._available_ids:
            identifier = self._available_ids.pop(0)
        else:
            identifier = self._next_id
            self._next_id += 1
        session_id = str(uuid.uuid4())
        session = {
            "state": {},
            "rooms": set(),
            "sequence": 0,
            "frames": [],
            "expires": float("inf"),
        }
        self.sessions[session_id] = session
        connection = SonicWSConnection(
            socket, self, identifier, session_id, session["state"]
        )
        self.connections.append(connection)
        self.connection_map[connection.id] = connection
        if await self._middleware("onClientConnect", connection):
            await connection.close(
                CloseCodes.MIDDLEWARE, "connection blocked by middleware"
            )
            self._remove(connection)
            self.sessions.pop(session_id, None)
            return
        client_data = self.client_packets.serialize()
        handshake = (
            b"SWS"
            + bytes([VERSION])
            + deflate(
                varint(connection.id)
                + varint(len(session_id.encode()))
                + session_id.encode()
                + varint(len(client_data))
                + client_data
                + self.server_packets.serialize()
            )
        )
        await socket.send(handshake)
        for callback in self.connect_listeners:
            result = callback(connection)
            if asyncio.iscoroutine(result):
                await result
        await connection.run()

    def _remove(self, connection):
        session = self.sessions.get(connection.session_id)
        if session is not None:
            session["rooms"] = set(connection.tags)
            session["expires"] = time.monotonic() + self.recovery_max_disconnection
            asyncio.get_running_loop().call_later(
                self.recovery_max_disconnection + 0.001,
                self._expire_session,
                connection.session_id,
                session,
            )
        if connection in self.connections:
            self.connections.remove(connection)
        if self.connection_map.pop(connection.id, None) is not None:
            self._available_ids.append(connection.id)
            self._available_ids.sort()
        self._adapter_background("disconnect", connection.id)

    def _expire_session(self, session_id, expected):
        current = self.sessions.get(session_id)
        if current is expected and current["expires"] <= time.monotonic():
            self.sessions.pop(session_id, None)

    def replay_frame(self, connection, packet_frame):
        session = self.sessions.get(connection.session_id)
        if session is None:
            return packet_frame
        session["sequence"] += 1
        frame = encode_replay(session["sequence"], packet_frame)
        session["frames"].append((session["sequence"], frame))
        if len(session["frames"]) > self.recovery_max_packets:
            del session["frames"][: -self.recovery_max_packets]
        return frame

    async def resume_session(self, connection, session_id, last_sequence):
        session = self.sessions.get(session_id)
        if session is None or session["expires"] < time.monotonic():
            await connection.raw_send(encode_resumed(False, 0))
            return
        if self.recovery_authorize:
            authorized = self.recovery_authorize(
                session["state"], connection.state, connection
            )
            if inspect.isawaitable(authorized):
                authorized = await authorized
        else:
            previous_user = session["state"].get(
                "userId", session["state"].get("user_id")
            )
            current_user = connection.state.get(
                "userId", connection.state.get("user_id")
            )
            authorized = previous_user is None or previous_user == current_user
        if not authorized:
            await connection.raw_send(encode_resumed(False, 0))
            return
        self.sessions.pop(connection.session_id, None)
        connection.session_id = session_id
        connection.state = session["state"]
        session["expires"] = float("inf")
        self.sessions[session_id] = session
        for room in session["rooms"]:
            self.join(connection, room)
        frames = [
            frame for sequence, frame in session["frames"] if sequence > last_sequence
        ]
        for frame in frames:
            await connection.raw_send(frame)
        await connection.raw_send(encode_resumed(True, len(frames)))
        for callback in self.recovered_listeners:
            result = callback(connection, len(frames))
            if inspect.isawaitable(result):
                await result

    async def _receive_adapter_broadcast(self, message):
        if message.get("origin") == self.server_id:
            return
        room = message["room"]
        excluded = message.get("exceptConnectionId")
        await self.broadcast_filtered(
            message["packetTag"],
            lambda connection: room in connection.tags and connection.id != excluded,
            *message.get("values", ()),
        )

    def on_connect(self, listener):
        self.connect_listeners.append(listener)

    def on_recovered(self, listener):
        self.recovered_listeners.append(listener)

    def on_ready(self, listener):
        self.ready_listeners.append(listener)

    def set_client_rate_limit(self, limit):
        self.client_rate_limit = _rate_limit(limit)

    def set_server_rate_limit(self, limit):
        self.server_rate_limit = _rate_limit(limit)

    def require_handshake(self, packet):
        if packet not in self.client_packets:
            raise ValueError(f"Unknown client packet {packet!r}")
        if self.client_packets.packet(packet).data_batching:
            raise ValueError("a batched packet cannot be used as a handshake")
        self.handshake_packet = packet

    async def broadcast(self, tag, *values):
        await self._broadcast(
            tag,
            BCInfo(type="all", recipients=list(self.connections)),
            self.connections,
            values,
        )

    async def broadcast_filtered(self, tag, predicate, *values):
        recipients = [c for c in tuple(self.connections) if predicate(c)]
        await self._broadcast(
            tag,
            BCInfo(type="filter", filter=predicate, recipients=recipients),
            recipients,
            values,
        )

    async def broadcast_tagged(self, connection_tag, packet_tag, *values):
        recipients = [c for c in tuple(self.connections) if connection_tag in c.tags]
        await self._broadcast(
            packet_tag,
            BCInfo(type="tagged", tag=connection_tag, recipients=recipients),
            recipients,
            values,
        )

    async def broadcast_room(self, room, packet_tag, *values):
        await self.broadcast_tagged(room, packet_tag, *values)
        await self._adapter_call(
            "publish",
            {
                "origin": self.server_id,
                "room": room,
                "packetTag": packet_tag,
                "values": list(values),
            },
        )

    async def broadcast_room_except(self, connection, room, packet_tag, *values):
        await self.broadcast_filtered(
            packet_tag,
            lambda item: item is not connection and room in item.tags,
            *values,
        )
        await self._adapter_call(
            "publish",
            {
                "origin": self.server_id,
                "room": room,
                "packetTag": packet_tag,
                "values": list(values),
                "exceptConnectionId": connection.id,
            },
        )

    async def _broadcast(self, tag, info, recipients, values):
        if await self._middleware("onPacketBroadcast_pre", tag, info, *values):
            return
        if not recipients:
            return
        packet = self.server_packets.packet(tag)
        if packet.rereference:
            raise ValueError("cannot broadcast a rereferenced packet")
        data = packet.encode(values, -1)
        if await self._middleware("onPacketBroadcast_post", tag, info, data, len(data)):
            return
        code = self.server_packets.code(tag)
        await asyncio.gather(
            *(
                connection.send_processed(code, data, packet)
                for connection in recipients
            )
        )

    async def broadcast_safe(self, tag, *values):
        try:
            await self.broadcast(tag, *values)
            return True
        except Exception as error:
            self.handle_send_error(error, {"packetTag": tag, "operation": "broadcast"})
            return False

    async def broadcast_variant(self, parent, variant, *values):
        await self.broadcast(self.server_packets.variant_tag(parent, variant), *values)

    async def broadcast_permutation(self, parent, selection, *values):
        await self.broadcast(
            self.server_packets.permutation_tag(parent, selection), *values
        )

    def handle_send_error(self, error, context):
        if self.on_send_error:
            self.on_send_error(error, context)
        else:
            logger.exception(
                'Failed to send packet "%s"', context["packetTag"], exc_info=error
            )

    def enable_packet(self, tag):
        self.client_packets.packet(tag).default_enabled = True
        for connection in self.connections:
            connection.enable_packet(tag)

    def disable_packet(self, tag):
        self.client_packets.packet(tag).default_enabled = False
        for connection in self.connections:
            connection.disable_packet(tag)

    def get_connected(self):
        return self.connections

    def get_socket(self, identifier):
        return self.connection_map.get(identifier)

    async def close_socket(self, identifier, code=1000, reason=""):
        connection = self.get_socket(identifier)
        if connection is None:
            raise KeyError(f"Unknown socket id {identifier}")
        await connection.close(code, reason)

    def tag(self, connection, value, replace=True):
        if connection not in self.connections:
            raise ValueError("connection does not belong to this server")
        if replace:
            for existing in tuple(connection.tags):
                self._adapter_background("leave", connection.id, existing)
            connection.tags.clear()
        connection.tags.add(value)
        self._adapter_background("join", connection.id, value)

    def join(self, connection, room):
        if not room:
            raise ValueError("room name cannot be empty")
        self.tag(connection, room, False)

    def leave(self, connection, room):
        connection.tags.discard(room)
        self._adapter_background("leave", connection.id, room)

    def open_debug(self, data=None, *, port=0, password=""):
        if self.debug_server is not None:
            raise RuntimeError("the debug server is already open")
        if isinstance(data, dict):
            port = data.get("port", port)
            password = data.get("password", password)
        from .debug import DebugServer

        self.debug_server = DebugServer(self, port=port, password=password)
        asyncio.get_running_loop().create_task(self.debug_server.start())
        return self.debug_server

    async def shutdown(self):
        for connection in tuple(self.connections):
            await connection.close(CloseCodes.MANUAL_SHUTDOWN, "server shutdown")
        if self._server:
            self._server.close()
            await self._server.wait_closed()
        if self.debug_server:
            await self.debug_server.shutdown()
        await self._adapter_call("close")

    async def __aenter__(self):
        return await self.start()

    async def __aexit__(self, *_):
        await self.shutdown()

    addMiddleware = add_middleware
    callMiddleware = call_middleware
    onConnect = on_connect
    onRecovered = on_recovered
    onReady = on_ready
    requireHandshake = require_handshake
    setClientRateLimit = set_client_rate_limit
    setServerRateLimit = set_server_rate_limit
    broadcastFiltered = broadcast_filtered
    broadcastTagged = broadcast_tagged
    broadcastRoom = broadcast_room
    broadcastRoomExcept = broadcast_room_except
    broadcastSafe = broadcast_safe
    broadcastVariant = broadcast_variant
    broadcastPermutation = broadcast_permutation
    enablePacket = enable_packet
    disablePacket = disable_packet
    getConnected = get_connected
    getSocket = get_socket
    closeSocket = close_socket
    OpenDebug = open_debug
