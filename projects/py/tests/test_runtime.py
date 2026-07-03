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
import json

from websockets.asyncio.client import connect

from sonic_ws import SonicWSServer


async def http_get(port, path):
    reader, writer = await asyncio.open_connection("127.0.0.1", port)
    writer.write(
        f"GET {path} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n\r\n".encode()
    )
    await writer.drain()
    response = await reader.read()
    writer.close()
    await writer.wait_closed()
    return response


async def main():
    server = SonicWSServer(port=0)
    await server.start()
    try:
        dashboard = server.OpenDebug({"port": 0, "password": "secret"})
        await dashboard.wait_ready()
        page = await http_get(dashboard.port, "/")
        assert page.startswith(b"HTTP/1.1 200") and b"SonicWS Debug" in page

        async with connect(f"ws://127.0.0.1:{dashboard.port}/ws") as socket:
            await socket.send(json.dumps({"type": "auth", "password": "secret"}))
            snapshot = json.loads(await socket.recv())
            assert snapshot["type"] == "snapshot"
    finally:
        await server.shutdown()
    print("Python debug runtime tests passed")


if __name__ == "__main__":
    asyncio.run(main())
