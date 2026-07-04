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
import warnings

from sonic_ws import (
    BCInfo,
    PacketType,
    SonicWSServer,
    SonicWS,
    create_obj_packet,
    create_packet,
    define_enum,
    wrap_enum,
)
from sonic_ws.connection import Connection


class FakeSocket:
    class State:
        name = "OPEN"

    state = State()

    def __init__(self):
        self.sent = []
        self.closed = None

    async def send(self, value):
        self.sent.append(bytes(value))

    async def close(self, code=1000, reason=""):
        self.closed = (code, reason)
        self.state.name = "CLOSED"


def test_schema_options():
    packet = create_packet(
        tag="wide",
        type=PacketType.UVARINT,
        noDataRange=True,
        async_=True,
        dataBatching=5,
        maxBatchSize=7,
        rateLimit=9,
        enabled=False,
    )
    assert packet.data_min == 0
    assert packet.data_max == 2_048_383
    assert packet.asynchronous and not packet.default_enabled
    assert (packet.data_batching, packet.max_batch_size, packet.rate_limit) == (5, 7, 9)
    assert create_packet(tag="rate16", rateLimit=65_535).rate_limit == 65_535
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        assert create_packet(tag="rate-unlimited", rateLimit=65_536).rate_limit == 0

    reref = create_packet(
        tag="cached", type=PacketType.UVARINT, noDataRange=True, rereference=True
    )
    assert reref.data_min == 1

    try:
        create_packet(tag="bad", type=PacketType.UVARINT, dataMin=0, rereference=True)
    except ValueError:
        pass
    else:
        raise AssertionError("rereference accepted a zero minimum")

    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        clamped = create_packet(tag="clamped", dataMin=-4, dataMax=9_999_999)
    assert (clamped.data_min, clamped.data_max) == (0, 2_048_383)


def test_object_ranges_and_enum_identity():
    packet = create_obj_packet(
        tag="object",
        types=[PacketType.STRINGS_ASCII, PacketType.BOOLEANS],
        dataMins=[1, 2],
        dataMaxes=[1, 2],
    )
    encoded = packet.encode((["hello"], [True, False]))
    assert packet.decode(encoded) == [["hello"], [True, False]]

    for values in (([], [True, False]), (["hello"], [True])):
        try:
            packet.encode(values)
        except ValueError:
            pass
        else:
            raise AssertionError("object range was not enforced")

    package = define_enum("parity-bool-int", [True, 1, math.nan])
    assert wrap_enum(package.tag, True) == 0
    assert wrap_enum(package.tag, 1) == 1
    assert wrap_enum(package.tag, math.nan) == 2


async def test_middleware_and_timers():
    socket = FakeSocket()
    connection = Connection(socket)
    calls = []

    class Middleware:
        def init(self, holder):
            calls.append(("init", holder))

        async def onNameChange(self, name):
            calls.append(("name", name))
            return name == "blocked"

    middleware = Middleware()
    connection.add_middleware(middleware)
    assert calls == [("init", connection)]
    await connection.set_name("allowed")
    await connection.set_name("blocked")
    assert connection.get_name() == "allowed"
    raw_sends = []
    connection.raw_onsend(raw_sends.append)
    await connection.raw_send(b"raw")
    assert raw_sends == [b"raw"]

    closed = []
    connection.set_timeout(
        lambda was_closed=True: closed.append(was_closed), 10_000, True
    )
    await connection._shutdown(1000, "test")
    assert closed == [True]


async def test_handshake_failure_propagates():
    class InvalidHandshakeSocket(FakeSocket):
        close_code = None
        close_reason = ""

        async def recv(self):
            return b"not-sonicws"

        def __aiter__(self):
            return self

        async def __anext__(self):
            raise StopAsyncIteration

    client = SonicWS(InvalidHandshakeSocket())
    client._reader = asyncio.create_task(client._run())
    try:
        await asyncio.wait_for(client.wait_ready(), 1)
    except ValueError as error:
        assert "not a SonicWS server" in str(error)
    else:
        raise AssertionError("invalid handshake did not propagate to wait_ready")
    await client._reader


async def test_server_helpers_and_broadcast_middleware():
    packet = create_packet(tag="value", type=PacketType.UVARINT, dataMin=1, dataMax=1)
    server = SonicWSServer(server_packets=[packet])
    first = type("ConnectionStub", (), {})()
    second = type("ConnectionStub", (), {})()
    for index, connection in enumerate((first, second), 1):
        connection.id = index
        connection.tags = set()
        connection.sent = []

        async def send_processed(code, data, schema, target=connection):
            target.sent.append((code, data, schema.tag))

        async def close(code=1000, reason="", target=connection):
            target.closed = (code, reason)

        connection.send_processed = send_processed
        connection.close = close

    server.connections[:] = [first, second]
    server.connection_map.update({1: first, 2: second})
    server.tag(first, "red")
    server.tag(second, "blue")

    calls = []

    class Middleware:
        def init(self, holder):
            calls.append("init")

        def onPacketBroadcast_pre(self, tag, info, *values):
            assert isinstance(info, BCInfo)
            calls.append(("pre", tag, info.type, values))

        def onPacketBroadcast_post(self, tag, info, data, size):
            calls.append(("post", tag, size))

    server.add_middleware(Middleware())
    await server.broadcast_tagged("red", "value", 7)
    assert len(first.sent) == 1 and second.sent == []
    assert calls[0] == "init" and calls[1][0] == "pre" and calls[2][0] == "post"
    assert (
        server.get_socket(2) is second and server.get_connected() is server.connections
    )
    await server.close_socket(2, 4008, "done")
    assert second.closed == (4008, "done")


async def main():
    test_schema_options()
    test_object_ranges_and_enum_identity()
    await test_middleware_and_timers()
    await test_handshake_failure_propagates()
    await test_server_helpers_and_broadcast_middleware()
    print("Python API parity tests passed")


if __name__ == "__main__":
    asyncio.run(main())
