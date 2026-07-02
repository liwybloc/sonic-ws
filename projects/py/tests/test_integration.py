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
from sonic_ws import CreatePacket, PacketType, SonicWS, SonicWSServer


async def main():
    print("Creating packet definitions...")

    packets = [
        CreatePacket(
            {"tag": "numbers", "type": PacketType.UVARINT, "dataMin": 3, "dataMax": 3}
        ),
        CreatePacket(
            {"tag": "json", "type": PacketType.JSON, "dataMin": 1, "dataMax": 1}
        ),
    ]

    print("Starting SonicWS server...")

    server = SonicWSServer(client_packets=packets, server_packets=packets, port=0)
    server_values = []

    def handle_server_connect(connection):
        print("Server: client connected")

        connection.on(
            "numbers",
            lambda *values: (
                print(f"Server received numbers: {list(values)}"),
                server_values.append(list(values)),
            ),
        )

        connection.on(
            "json",
            lambda value: (
                print(f"Server received json: {value}"),
                server_values.append(value),
            ),
        )

    server.on_connect(handle_server_connect)

    await server.start()
    print(f"Server started on port {server.port}")

    print("Connecting client...")

    client = await asyncio.wait_for(
        SonicWS.connect(f"ws://127.0.0.1:{server.port}"),
        5,
    )

    print("Client connected")

    client_values = []

    client.on(
        "numbers",
        lambda *values: (
            print(f"Client received numbers: {list(values)}"),
            client_values.append(list(values)),
        ),
    )

    client.on(
        "json",
        lambda value: (
            print(f"Client received json: {value}"),
            client_values.append(value),
        ),
    )

    print("Client sending numbers: [1, 128, 16384]")
    await client.send("numbers", 1, 128, 16384)

    print("Client sending json: {'from': 'client'}")
    await client.send("json", {"from": "client"})

    print("Waiting for server to receive 2 messages...")
    while len(server_values) < 2:
        await asyncio.sleep(0.01)

    print(f"Server received all values: {server_values}")

    connection = server.connections[0]

    print("Server sending numbers: [2, 3, 4]")
    await connection.send("numbers", 2, 3, 4)

    print("Server sending json: {'from': 'server'}")
    await connection.send("json", {"from": "server"})

    print("Waiting for client to receive 2 messages...")
    while len(client_values) < 2:
        await asyncio.sleep(0.01)

    print(f"Client received all values: {client_values}")

    print("Checking assertions...")

    assert server_values == [[1, 128, 16384], {"from": "client"}]
    assert client_values == [[2, 3, 4], {"from": "server"}]

    print("Assertions passed")

    print("Closing client...")
    await client.close()

    print("Shutting down server...")
    await server.shutdown()

    print("Done")


if __name__ == "__main__":
    asyncio.run(main())