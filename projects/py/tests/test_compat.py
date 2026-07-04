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

import argparse
import asyncio
import contextlib
import math
import pathlib
import sys
from dataclasses import dataclass
from typing import Any, Callable

PYTHON_ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PYTHON_ROOT / "src"))

from sonic_ws import (
    CreateEnumPacket,
    CreateObjPacket,
    CreatePacket,
    DefineEnum,
    PacketType,
    SonicWS,
    SonicWSServer,
    WrapEnum,
)

PORT = 8963
HOST = "127.0.0.1"


MIXED_ENUM = DefineEnum("compat-mixed", ["alpha", 7, True, None])
OBJECT_ENUM = DefineEnum("compat-object", ["left", "right"])


@dataclass(frozen=True)
class CompatCase:
    name: str
    create: Callable[[str], Any]
    send: list[Any]
    expected: list[Any]


CASES = [
    CompatCase(
        name="none",
        create=lambda tag: CreatePacket(
            {
                "tag": tag,
                "type": PacketType.NONE,
                "dataMin": 0,
                "dataMax": 0,
            }
        ),
        send=[],
        expected=[None],
    ),
    CompatCase(
        name="raw",
        create=lambda tag: CreatePacket(
            {
                "tag": tag,
                "type": PacketType.RAW,
                "dataMin": 4,
                "dataMax": 4,
            }
        ),
        send=[0, 1, 128, 255],
        expected=[bytes([0, 1, 128, 255])],
    ),
    CompatCase(
        name="ascii",
        create=lambda tag: CreatePacket(
            {
                "tag": tag,
                "type": PacketType.STRINGS_ASCII,
                "dataMin": 3,
                "dataMax": 3,
            }
        ),
        send=["hello world", "SonicWS", ""],
        expected=["hello world", "SonicWS", ""],
    ),
    CompatCase(
        name="utf16",
        create=lambda tag: CreatePacket(
            {
                "tag": tag,
                "type": PacketType.STRINGS_UTF16,
                "dataMin": 4,
                "dataMax": 4,
            }
        ),
        send=["another😂", "𐍈", "𝄞", "🧪"],
        expected=["another😂", "𐍈", "𝄞", "🧪"],
    ),
    CompatCase(
        name="enums",
        create=lambda tag: CreateEnumPacket(
            {
                "tag": tag,
                "enumData": MIXED_ENUM,
                "dataMin": 4,
                "dataMax": 4,
            }
        ),
        send=[WrapEnum(MIXED_ENUM.tag, value) for value in MIXED_ENUM.values],
        expected=list(MIXED_ENUM.values),
    ),
    CompatCase(
        name="bytes",
        create=lambda tag: CreatePacket(
            {
                "tag": tag,
                "type": PacketType.BYTES,
                "dataMin": 5,
                "dataMax": 5,
            }
        ),
        send=[-128, -1, 0, 1, 127],
        expected=[-128, -1, 0, 1, 127],
    ),
    CompatCase(
        name="ubytes",
        create=lambda tag: CreatePacket(
            {
                "tag": tag,
                "type": PacketType.UBYTES,
                "dataMin": 4,
                "dataMax": 4,
            }
        ),
        send=[0, 1, 254, 255],
        expected=[0, 1, 254, 255],
    ),
    CompatCase(
        name="shorts",
        create=lambda tag: CreatePacket(
            {
                "tag": tag,
                "type": PacketType.SHORTS,
                "dataMin": 5,
                "dataMax": 5,
            }
        ),
        send=[-32768, -1, 0, 1, 32767],
        expected=[-32768, -1, 0, 1, 32767],
    ),
    CompatCase(
        name="ushorts",
        create=lambda tag: CreatePacket(
            {
                "tag": tag,
                "type": PacketType.USHORTS,
                "dataMin": 4,
                "dataMax": 4,
            }
        ),
        send=[0, 1, 65534, 65535],
        expected=[0, 1, 65534, 65535],
    ),
    CompatCase(
        name="varint",
        create=lambda tag: CreatePacket(
            {
                "tag": tag,
                "type": PacketType.VARINT,
                "dataMin": 5,
                "dataMax": 5,
            }
        ),
        send=[-2147483648, -1, 0, 1, 2147483647],
        expected=[-2147483648, -1, 0, 1, 2147483647],
    ),
    CompatCase(
        name="uvarint",
        create=lambda tag: CreatePacket(
            {
                "tag": tag,
                "type": PacketType.UVARINT,
                "dataMin": 7,
                "dataMax": 7,
            }
        ),
        send=[0, 1, 127, 128, 255, 16384, 4294967295],
        expected=[0, 1, 127, 128, 255, 16384, 4294967295],
    ),
    CompatCase(
        name="deltas",
        create=lambda tag: CreatePacket(
            {
                "tag": tag,
                "type": PacketType.DELTAS,
                "dataMin": 8,
                "dataMax": 8,
            }
        ),
        send=[-50, -25, 1, 2, 1000, 1004, 1004, -5],
        expected=[-50, -25, 1, 2, 1000, 1004, 1004, -5],
    ),
    CompatCase(
        name="floats",
        create=lambda tag: CreatePacket(
            {
                "tag": tag,
                "type": PacketType.FLOATS,
                "dataMin": 5,
                "dataMax": 5,
            }
        ),
        send=[0, 1.5, -1.5, 958412.128498, 1e-10],
        expected=[0, 1.5, -1.5, 958412.125, 1.000000013351432e-10],
    ),
    CompatCase(
        name="doubles",
        create=lambda tag: CreatePacket(
            {
                "tag": tag,
                "type": PacketType.DOUBLES,
                "dataMin": 5,
                "dataMax": 5,
            }
        ),
        send=[0, 1.5, -1.5, 958412.128498, math.inf],
        expected=[0, 1.5, -1.5, 958412.1284979999, math.inf],
    ),
    CompatCase(
        name="booleans",
        create=lambda tag: CreatePacket(
            {
                "tag": tag,
                "type": PacketType.BOOLEANS,
                "dataMin": 9,
                "dataMax": 9,
            }
        ),
        send=[True, False, True, False, True, False, True, False, True],
        expected=[True, False, True, False, True, False, True, False, True],
    ),
    CompatCase(
        name="json",
        create=lambda tag: CreatePacket(
            {
                "tag": tag,
                "type": PacketType.JSON,
                "dataMin": 1,
                "dataMax": 1,
            }
        ),
        send=[{"ok": True, "nested": [1, "two", False, None]}],
        expected=[{"ok": True, "nested": [1, "two", False, None]}],
    ),
    CompatCase(
        name="hex",
        create=lambda tag: CreatePacket(
            {
                "tag": tag,
                "type": PacketType.HEX,
                "dataMin": 1,
                "dataMax": 3,
            }
        ),
        send=["00abff"],
        expected=["00abff"],
    ),
    CompatCase(
        name="object",
        create=lambda tag: CreateObjPacket(
            {
                "tag": tag,
                "types": [
                    PacketType.STRINGS_ASCII,
                    PacketType.BOOLEANS,
                    PacketType.BYTES,
                    OBJECT_ENUM,
                    PacketType.JSON,
                ],
                "dataMins": [2, 3, 3, 2, 1],
                "dataMaxes": [2, 3, 3, 2, 1],
                "gzipCompression": False,
            }
        ),
        send=[
            ["hello", "world"],
            [True, False, True],
            [-1, 0, 1],
            [
                WrapEnum(OBJECT_ENUM.tag, "right"),
                WrapEnum(OBJECT_ENUM.tag, "left"),
            ],
            [{"json": True}],
        ],
        expected=[
            ["hello", "world"],
            [True, False, True],
            [-1, 0, 1],
            ["right", "left"],
            [{"json": True}],
        ],
    ),
    CompatCase(
        name="batch",
        create=lambda tag: CreatePacket(
            {
                "tag": tag,
                "type": PacketType.UVARINT,
                "dataMin": 3,
                "dataMax": 3,
                "dataBatching": 10,
                "maxBatchSize": 4,
                "gzipCompression": True,
            }
        ),
        send=[7, 128, 16384],
        expected=[7, 128, 16384],
    ),
]


def make_packets(prefix: str) -> list[Any]:
    return [case.create(f"{prefix}_{case.name}") for case in CASES]


def normalize(value: Any) -> Any:
    if isinstance(value, (bytes, bytearray, memoryview)):
        return list(value)

    if isinstance(value, tuple):
        return [normalize(item) for item in value]

    if isinstance(value, list):
        return [normalize(item) for item in value]

    if isinstance(value, dict):
        return {key: normalize(nested) for key, nested in value.items()}

    if isinstance(value, float) and math.isnan(value):
        return "NaN"

    return value


def assert_compatible(actual: Any, expected: Any, tag: str) -> None:
    normalized_actual = normalize(actual)
    normalized_expected = normalize(expected)

    if normalized_actual != normalized_expected:
        raise AssertionError(
            f"{tag} mismatch\n"
            f"actual:   {normalized_actual!r}\n"
            f"expected: {normalized_expected!r}"
        )


def register_expectations(
    name: str, endpoint: Any, prefix: str
) -> list[asyncio.Future[None]]:
    loop = asyncio.get_running_loop()
    futures: list[asyncio.Future[None]] = []

    for case in CASES:
        tag = f"{prefix}_{case.name}"
        future: asyncio.Future[None] = loop.create_future()
        futures.append(future)

        def handler(
            *received: Any,
            case: CompatCase = case,
            tag: str = tag,
            future: asyncio.Future[None] = future,
        ) -> None:
            if future.done():
                return

            try:
                assert_compatible(list(received), case.expected, tag)
                print(f"ok - {name} received {tag}: {normalize(list(received))!r}")
                future.set_result(None)
            except Exception as error:
                future.set_exception(error)

        endpoint.on(tag, handler)

    return futures


async def send_all(name: str, endpoint: Any, prefix: str) -> None:
    for case in CASES:
        tag = f"{prefix}_{case.name}"

        print(f"{name} sending {tag}: {normalize(case.send)!r}")

        try:
            await endpoint.send(tag, *case.send)
        except Exception as error:
            print(f"{name} FAILED sending {tag}")
            print(f"payload: {normalize(case.send)!r}")
            print(f"error: {error!r}")
            raise

        print(f"{name} sent {tag}")

    # Batched packets flush asynchronously after their configured interval.
    await asyncio.sleep(0.1)


async def wait_all(
    futures: list[asyncio.Future[None]],
    timeout: float,
    label: str,
) -> None:
    await asyncio.wait_for(asyncio.gather(*futures), timeout=timeout)
    print(f"{label}: received all {len(futures)} expected packets")


async def run_host() -> None:
    server = SonicWSServer(
        client_packets=make_packets("client"),
        server_packets=make_packets("server"),
        host=HOST,
        port=PORT,
    )

    connected = asyncio.Event()
    connection_holder: dict[str, Any] = {}
    host_receives: list[asyncio.Future[None]] = []

    def on_connect(connection: Any) -> None:
        print("Host: client connected")
        connection_holder["connection"] = connection
        host_receives.extend(register_expectations("Host", connection, "client"))
        connected.set()

    server.on_connect(on_connect)

    print(f"Host: starting server on ws://{HOST}:{PORT}")
    await server.start()

    try:
        await asyncio.wait_for(connected.wait(), timeout=60)
        connection = connection_holder["connection"]

        await asyncio.sleep(0.25)
        await send_all("Host", connection, "server")

        await wait_all(host_receives, timeout=15, label="Host")

        print(f"Host: passed {len(CASES)} packet checks")

    except KeyboardInterrupt:
        print("\nHost: shutting down...")

    finally:
        await server.shutdown()
        print("Host: stopped")


async def run_client() -> None:
    url = f"ws://{HOST}:{PORT}"

    print(f"Client: connecting to {url}")
    client = await asyncio.wait_for(SonicWS.connect(url), timeout=10)

    try:
        print("Client: connected")

        client_receives = register_expectations("Client", client, "server")

        await asyncio.sleep(0.5)
        await send_all("Client", client, "client")

        await wait_all(client_receives, timeout=15, label="Client")

        print(f"Client: passed {len(CASES)} packet checks")

    except KeyboardInterrupt:
        print("\nClient: closing...")

    finally:
        with contextlib.suppress(Exception):
            await client.close()

        print("Client: stopped")


async def main() -> None:
    parser = argparse.ArgumentParser(description="SonicWS compatibility test")
    mode = parser.add_mutually_exclusive_group(required=True)

    mode.add_argument(
        "--host",
        action="store_true",
        help=f"host a SonicWS server on port {PORT}",
    )

    mode.add_argument(
        "--client",
        action="store_true",
        help=f"connect to a SonicWS server on port {PORT}",
    )

    args = parser.parse_args()

    if args.host:
        await run_host()
    elif args.client:
        await run_client()


if __name__ == "__main__":
    asyncio.run(main())
