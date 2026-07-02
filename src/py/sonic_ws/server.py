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
import importlib.resources
import logging
from pathlib import Path
import time
from websockets.asyncio.server import serve
from websockets.exceptions import ConnectionClosed
from websockets.datastructures import Headers
from websockets.http11 import Response
from .connection import Connection, PacketHolder, CloseCodes, dispatch_packet
from .codec import deflate
from .packets import varint, flatten_data
from .middleware import BCInfo

VERSION = 22
MAX_USHORT = 65_535
logger = logging.getLogger(__name__)


def _rate_limit(value):
    value = int(value)
    if value < 0:
        raise ValueError("rate limit cannot be negative")
    return 0 if value > MAX_USHORT else value


class SonicWSConnection(Connection):
    def __init__(self, socket, host, identifier):
        super().__init__(socket, identifier, f"Socket {identifier}")
        self.host = host
        self.handshake_complete = host.handshake_packet is None
        self.enabled = {p.tag: p.default_enabled for p in host.client_packets.packets}
        self.tags = set()

    async def run(self):
        try:
            async for message in self.socket:
                raw = bytes(message)
                await self._emit("__raw_message__", raw, False)
                if not raw:
                    await self.close(CloseCodes.SMALL, "empty packet")
                    return
                if raw[0] == 0 or raw[0] > len(self.host.client_packets.packets):
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
                        f'{tag}: {error}',
                    )
                    return
        except ConnectionClosed:
            pass
        finally:
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
            if await self._middleware("onSend_pre", tag, list(values), int(time.time() * 1000), time.perf_counter() * 1000):
                return
            packet = self.host.server_packets.packet(tag)
            code = self.host.server_packets.code(tag)
            if packet.rereference and packet.last_sent.get(self.id) == values:
                data = b""
            else:
                data = packet.encode(
                    (flatten_data(values[0]),) if packet.auto_flatten else values
                )
                packet.last_sent[self.id] = values
            if await self._middleware("onSend_post", tag, data, len(data)):
                return
            await self.send_processed(code, data, packet)

    async def send_processed(self, code, data, packet):
        if not self._within_rate("server", self.host.server_rate_limit) or not self._within_rate("server:" + packet.tag, packet.rate_limit):
            return
        if packet.data_batching:
            await self._batch(code, packet, data)
        else:
            await self.raw_send(bytes([code]) + data)

    async def broadcast(self, tag, *values):
        await self.host.broadcast_filtered(tag, lambda c: c is not self, *values)

    async def broadcast_filtered(self, tag, predicate, *values):
        await self.host.broadcast_filtered(
            tag, lambda connection: connection is not self and predicate(connection), *values
        )

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


class SonicWSServer:
    def __init__(
        self,
        settings=None,
        client_packets=(),
        server_packets=(),
        host="127.0.0.1",
        port=0,
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
            sonic_options = dict(settings.get("sonicServerSettings", {}))
            host = options.pop("host", host)
            port = options.pop("port", port)
            kwargs = {**options, **kwargs}
        else:
            sonic_options = {}
        self.client_packets = PacketHolder(client_packets)
        self.server_packets = PacketHolder(server_packets)
        self.host = host
        self.port = port
        self.websocket_options = kwargs
        self.serve_browser_client = sonic_options.get(
            "serveBrowserClient", sonic_options.get("serve_browser_client", True)
        )
        self.connections = []
        self.connection_map = {}
        self.connect_listeners = []
        self.ready_listeners = []
        self.handshake_packet = None
        self._next_id = 1
        self._available_ids = []
        self._server = None
        self.client_rate_limit = 500
        self.server_rate_limit = 500
        self._middlewares = []
        self.debug_server = None

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
        existing_process_request = self.websocket_options.pop("process_request", None)

        async def process_request(connection, request):
            if self.serve_browser_client:
                asset = {
                    "/SonicWS/bundle.js": ("bundle.js", "text/javascript; charset=utf-8"),
                    "/SonicWS/bundle.wasm": ("bundle.wasm", "application/wasm"),
                }.get(request.path)
                if asset:
                    body = self._browser_asset(asset[0])
                    return Response(
                        200,
                        "OK",
                        Headers(
                            {
                                "Content-Type": asset[1],
                                "Content-Length": str(len(body)),
                                "Cache-Control": "public, max-age=3600",
                            }
                        ),
                        body,
                    )
            if existing_process_request:
                result = existing_process_request(connection, request)
                return await result if inspect.isawaitable(result) else result
            return None

        self._server = await serve(
            self._accept,
            self.host,
            self.port,
            process_request=process_request,
            **self.websocket_options,
        )
        if self._server.sockets:
            self.port = self._server.sockets[0].getsockname()[1]
        for callback in self.ready_listeners:
            result = callback()
            if asyncio.iscoroutine(result):
                await result
        return self

    @staticmethod
    def _browser_asset(name):
        packaged = importlib.resources.files("sonic_ws").joinpath("_browser", name)
        if packaged.is_file():
            return packaged.read_bytes()
        source = Path(__file__).resolve().parents[3] / "bundled" / name
        if source.is_file():
            return source.read_bytes()
        raise FileNotFoundError(
            f"SonicWS browser asset {name!r} is not installed; rebuild the Python package"
        )

    async def _accept(self, socket):
        if self._available_ids:
            identifier = self._available_ids.pop(0)
        else:
            identifier = self._next_id
            self._next_id += 1
        connection = SonicWSConnection(socket, self, identifier)
        self.connections.append(connection)
        self.connection_map[connection.id] = connection
        if await self._middleware("onClientConnect", connection):
            await connection.close(
                CloseCodes.MIDDLEWARE, "connection blocked by middleware"
            )
            self._remove(connection)
            return
        client_data = self.client_packets.serialize()
        handshake = (
            b"SWS"
            + bytes([VERSION])
            + deflate(
                varint(connection.id)
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
        if connection in self.connections:
            self.connections.remove(connection)
        if self.connection_map.pop(connection.id, None) is not None:
            self._available_ids.append(connection.id)
            self._available_ids.sort()

    def on_connect(self, listener):
        self.connect_listeners.append(listener)

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
        await self._broadcast(tag, BCInfo(type="all", recipients=list(self.connections)), self.connections, values)

    async def broadcast_filtered(self, tag, predicate, *values):
        recipients = [c for c in tuple(self.connections) if predicate(c)]
        await self._broadcast(tag, BCInfo(type="filter", filter=predicate, recipients=recipients), recipients, values)

    async def broadcast_tagged(self, connection_tag, packet_tag, *values):
        recipients = [c for c in tuple(self.connections) if connection_tag in c.tags]
        await self._broadcast(packet_tag, BCInfo(type="tagged", tag=connection_tag, recipients=recipients), recipients, values)

    async def _broadcast(self, tag, info, recipients, values):
        if await self._middleware("onPacketBroadcast_pre", tag, info, *values):
            return
        if not recipients:
            return
        packet = self.server_packets.packet(tag)
        if packet.rereference:
            raise ValueError("cannot broadcast a rereferenced packet")
        encoded_values = (flatten_data(values[0]),) if packet.auto_flatten else values
        data = packet.encode(encoded_values)
        if await self._middleware("onPacketBroadcast_post", tag, info, data, len(data)):
            return
        code = self.server_packets.code(tag)
        await asyncio.gather(*(connection.send_processed(code, data, packet) for connection in recipients))

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
            connection.tags.clear()
        connection.tags.add(value)

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

    async def __aenter__(self):
        return await self.start()

    async def __aexit__(self, *_):
        await self.shutdown()

    addMiddleware = add_middleware
    callMiddleware = call_middleware
    onConnect = on_connect
    onReady = on_ready
    requireHandshake = require_handshake
    setClientRateLimit = set_client_rate_limit
    setServerRateLimit = set_server_rate_limit
    broadcastFiltered = broadcast_filtered
    broadcastTagged = broadcast_tagged
    enablePacket = enable_packet
    disablePacket = disable_packet
    getConnected = get_connected
    getSocket = get_socket
    closeSocket = close_socket
    OpenDebug = open_debug
