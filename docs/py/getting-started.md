# Python getting started

Python 3.10+, `websockets>=14`, and `wasmtime` are required. Building from source also requires a Rust toolchain; wheel creation compiles and bundles the portable Rust WASM codec.

```py
import asyncio
from sonic_ws import SonicWS, SonicWSServer, PacketType, create_packet

client_packets = [
    create_packet(tag="chat", type=PacketType.STRINGS_UTF16, dataMax=1),
]
server_packets = [
    create_packet(tag="accepted", type=PacketType.BOOLEANS, dataMax=1),
]

async def main():
    server = SonicWSServer(
        client_packets=client_packets,
        server_packets=server_packets,
        host="127.0.0.1",
        port=8080,
    )

    async def connected(connection):
        async def chat(text):
            await connection.send("accepted", bool(text))
        connection.on("chat", chat)

    server.on_connect(connected)
    await server.start()

    client = await SonicWS.connect("ws://127.0.0.1:8080")
    client.on("accepted", print)
    await client.send("chat", "hello")

    await client.close()
    await server.shutdown()

asyncio.run(main())
```

`SonicWS.connect` returns only after schema negotiation, so packet definitions and `id` are available immediately. Callbacks may be regular functions or async functions.

The server is also an async context manager:

```py
async with SonicWSServer(client_packets=client_packets, port=8080) as server:
    ...
```
