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
from sonic_ws import CreatePacket, PacketType, SonicWS, SonicWSServer, PacketLogger


async def main():
    print("Creating packet definitions...")

    packets = [
        CreatePacket(
            {"tag": "numbers", "type": PacketType.UVARINT, "dataMin": 3, "dataMax": 3}
        ),
        CreatePacket(
            {"tag": "json", "type": PacketType.JSON, "dataMin": 1, "dataMax": 1}
        ),
        CreatePacket({"tag": "point", "type": PacketType.VARINT, "schema": ["x", "y"], "dataMax": 2, "replay": True}),
    ]

    print("Starting SonicWS server...")

    adapter_events = []

    class Adapter:
        def start(self, server_id, receiver):
            self.receiver = receiver
        def publish(self, message):
            adapter_events.append(("publish", message))
        def join(self, identifier, room):
            adapter_events.append(("join", identifier, room))
        def leave(self, identifier, room):
            adapter_events.append(("leave", identifier, room))
        def disconnect(self, identifier):
            adapter_events.append(("disconnect", identifier))
        def close(self):
            pass

    server = SonicWSServer(client_packets=packets, server_packets=packets, port=0, adapter=Adapter())
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
        SonicWS.connect(f"ws://127.0.0.1:{server.port}", reconnect={"enabled": True, "attempts": 5, "minDelayMs": 150, "maxDelayMs": 150, "jitter": 0}),
        5,
    )

    print("Client connected")
    packet_logs = []
    client.add_middleware(PacketLogger(logger=packet_logs.append))

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
    connection.add_middleware(PacketLogger(logger=packet_logs.append))
    connection.state["player"] = {"id": 7}
    connection.respond("point", lambda value: {"sum": value["x"] + value["y"]})
    client.respond("point", lambda value: {"sum": value["x"] + value["y"]})
    assert await client.request("point", {"x": 3, "y": 4}) == {"sum": 7}
    assert await connection.request("point", {"x": 5, "y": 6}) == {"sum": 11}
    connection.join("world:one")
    room_value = asyncio.get_running_loop().create_future()
    client.on("point", lambda value: room_value.set_result(value) if not room_value.done() else None)
    await server.broadcast_room("world:one", "point", {"x": 8, "y": 9})
    assert await asyncio.wait_for(room_value, 2) == {"x": 8, "y": 9}
    assert any(event[0] == "join" and event[2] == "world:one" for event in adapter_events)
    assert any(event[0] == "publish" for event in adapter_events)

    recovered = asyncio.get_running_loop().create_future()
    client.on_recovered(lambda event: recovered.set_result(event) if not recovered.done() else None)
    replayed = asyncio.get_running_loop().create_future()
    client.on("point", lambda value: replayed.set_result(value) if value.get("x") == 10 and not replayed.done() else None)
    client.socket.transport.abort()
    while server.connections:
        await asyncio.sleep(.01)
    missed = server.server_packets.packet("point").encode(({"x": 10, "y": 11},), connection.id)
    server.replay_frame(connection, bytes([server.server_packets.code("point")]) + missed)
    assert await asyncio.wait_for(recovered, 5) == {"recovered": True, "replayed": 1}
    assert await asyncio.wait_for(replayed, 2) == {"x": 10, "y": 11}
    replacement = server.connections[0]
    assert replacement.state["player"] == {"id": 7}
    assert "world:one" in replacement.tags
    connection = replacement
    assert client.can_send_volatile()
    client.set_backpressure_limits(volatile_at_bytes=0, close_at_bytes=16 * 1024 * 1024)
    assert not client.can_send_volatile()
    client.set_backpressure_limits(volatile_at_bytes=1024 * 1024, close_at_bytes=16 * 1024 * 1024)

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
    assert any(entry["direction"] == "send" for entry in packet_logs)
    assert any(entry["direction"] == "receive" for entry in packet_logs)

    print("Assertions passed")

    print("Closing client...")
    await client.close()

    print("Shutting down server...")
    await server.shutdown()

    print("Done")


if __name__ == "__main__":
    asyncio.run(main())
