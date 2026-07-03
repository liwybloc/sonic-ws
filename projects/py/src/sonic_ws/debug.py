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

"""Small, dependency-free debug dashboard for Python SonicWS servers."""

import asyncio
import json
import time

from websockets.asyncio.server import serve
from websockets.datastructures import Headers
from websockets.exceptions import ConnectionClosed
from websockets.http11 import Response


_HTML = b"""<!doctype html><meta charset=utf-8><title>SonicWS Debug</title>
<style>body{font:14px system-ui;background:#101319;color:#e8ebf2;margin:20px}input,button{background:#202633;color:inherit;border:1px solid #394255;padding:6px}#log{white-space:pre-wrap;font-family:monospace}.recv{color:#ff8585}.send{color:#78e89b}</style>
<h1>SonicWS Debug</h1><input id=p type=password placeholder=password><button id=c>Connect</button><div id=s></div><div id=log></div>
<script>c.onclick=()=>{let w=new WebSocket(`ws://${location.host}/ws`);w.onopen=()=>w.send(JSON.stringify({type:'auth',password:p.value}));w.onmessage=e=>{let x=JSON.parse(e.data),d=document.createElement('div');d.className=x.direction||'';d.textContent=JSON.stringify(x);log.prepend(d)};w.onclose=e=>s.textContent=`closed ${e.code} ${e.reason}`;s.textContent='connecting'};</script>"""


class DebugServer:
    """Debug middleware and its dashboard server."""

    def __init__(self, host, port=0, password=""):
        if not 0 <= int(port) < 65536:
            raise ValueError("port out of range")
        self.host = host
        self.port = int(port)
        self.password = str(password)
        self.clients = set()
        self._server = None
        self._ready = asyncio.Event()
        self.started_at = time.time()
        host.add_middleware(self)

    def init(self, _holder):
        pass

    async def start(self):
        async def process_request(_connection, request):
            if request.path in ("/", "/index.html"):
                return Response(200, "OK", Headers({
                    "Content-Type": "text/html; charset=utf-8",
                    "Content-Length": str(len(_HTML)),
                }), _HTML)
            return None

        self._server = await serve(
            self._accept, "127.0.0.1", self.port, process_request=process_request
        )
        if self._server.sockets:
            self.port = self._server.sockets[0].getsockname()[1]
        self._ready.set()
        return self

    async def wait_ready(self):
        await self._ready.wait()
        return self

    async def shutdown(self):
        for client in tuple(self.clients):
            await client.close(1001, "debug server shutdown")
        if self._server:
            self._server.close()
            await self._server.wait_closed()

    async def _accept(self, socket):
        try:
            raw = await asyncio.wait_for(socket.recv(), 10)
            request = json.loads(raw)
            if request.get("type") != "auth" or request.get("password", "") != self.password:
                await socket.close(4007, "invalid password")
                return
            self.clients.add(socket)
            await socket.send(json.dumps({
                "type": "snapshot",
                "uptime": time.time() - self.started_at,
                "connections": [self._connection_data(c) for c in self.host.connections],
            }))
            async for raw in socket:
                command = json.loads(raw)
                if command.get("type") == "close":
                    connection = self.host.get_socket(int(command["id"]))
                    if connection:
                        await connection.close(4008, "closed by debug dashboard")
        except (ConnectionClosed, asyncio.TimeoutError, ValueError, json.JSONDecodeError):
            pass
        finally:
            self.clients.discard(socket)

    @staticmethod
    def _connection_data(connection):
        return {"id": connection.id, "name": connection.get_name(), "tags": sorted(connection.tags)}

    async def _publish(self, event):
        if not self.clients:
            return
        data = json.dumps({"time": time.time(), **event}, default=str)
        clients = tuple(self.clients)
        results = await asyncio.gather(
            *(client.send(data) for client in clients), return_exceptions=True
        )
        for client, result in zip(clients, results):
            if isinstance(result, Exception):
                self.clients.discard(client)

    def _schedule(self, event):
        try:
            asyncio.get_running_loop().create_task(self._publish(event))
        except RuntimeError:
            pass

    def onClientConnect(self, connection):
        connection.add_middleware(_ConnectionDebug(self, connection))
        self._schedule({"type": "connection", **self._connection_data(connection)})

    def onClientDisconnect(self, connection, code, reason):
        self._schedule({"type": "disconnection", "id": connection.id, "code": code, "reason": str(reason)})

    def onPacketBroadcast_pre(self, tag, info, *values):
        self._schedule({"type": "broadcast", "tag": tag, "recipients": [c.id for c in info.recipients], "values": values})


class _ConnectionDebug:
    def __init__(self, dashboard, connection):
        self.dashboard = dashboard
        self.connection = connection

    def onReceive_post(self, tag, values):
        self.dashboard._schedule({"type": "packet", "direction": "recv", "id": self.connection.id, "tag": tag, "values": values})

    def onSend_pre(self, tag, values, *_times):
        self.dashboard._schedule({"type": "packet", "direction": "send", "id": self.connection.id, "tag": tag, "values": values})

    def onNameChange(self, name):
        self.dashboard._schedule({"type": "name", "id": self.connection.id, "name": name})
