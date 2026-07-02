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

import math
import struct
from typing import Any


def _varint(value: int) -> bytes:
    if value < 0:
        raise ValueError("negative varint")
    out = bytearray()
    while True:
        byte = value & 0x7F
        value >>= 7
        out.append(byte | (0x80 if value else 0))
        if not value:
            return bytes(out)


def _read(data: bytes, offset: int) -> tuple[int, int]:
    value = shift = 0
    while offset < len(data) and shift <= 28:
        byte = data[offset]
        offset += 1
        value |= (byte & 0x7F) << shift
        if not byte & 0x80:
            return offset, value
        shift += 7
    raise ValueError("invalid JSON varint")


def compress_json(value: Any) -> bytes:
    bools, types, payload = [], [], bytearray()

    def string(value: str):
        raw = value.encode()
        payload.extend(_varint(len(raw)))
        payload.extend(raw)

    def encode(value: Any):
        if value is None:
            types.append(0)
        elif isinstance(value, bool):
            types.append(1)
            bools.append(value)
        elif isinstance(value, int):
            types.append(2)
            mapped = ((value << 1) ^ (value >> 31)) & 0xFFFFFFFF
            payload.extend(_varint(mapped))
        elif isinstance(value, float):
            types.append(3)
            payload.extend(struct.pack(">f", value))
        elif isinstance(value, str):
            types.append(4)
            string(value)
        elif isinstance(value, (list, tuple)):
            types.append(5)
            payload.extend(_varint(len(value)))
            for item in value:
                encode(item)
        elif isinstance(value, dict):
            types.append(6)
            payload.extend(_varint(len(value)))
            for key, item in value.items():
                string(str(key))
                encode(item)
        else:
            raise TypeError(f"Unsupported JSON type: {type(value).__name__}")

    encode(value)
    bool_bytes = bytes(
        sum((int(v) << (7 - (i % 8))) for i, v in enumerate(bools[j : j + 8]))
        for j in range(0, len(bools), 8)
    )
    bits = "".join(f"{kind:03b}" for kind in types)
    type_bytes = bytes(
        int(bits[i : i + 8].ljust(8, "0"), 2) for i in range(0, len(bits), 8)
    )
    return (
        _varint(len(bool_bytes))
        + _varint(len(type_bytes))
        + bool_bytes
        + type_bytes
        + payload
    )


def decompress_json(data: bytes) -> Any:
    offset, bool_len = _read(data, 0)
    offset, type_len = _read(data, offset)
    bool_data = data[offset : offset + bool_len]
    offset += bool_len
    bools = [bool(byte & (1 << (7 - i))) for byte in bool_data for i in range(8)]
    type_data = data[offset : offset + type_len]
    offset += type_len
    bits = "".join(f"{byte:08b}" for byte in type_data)
    types = [int(bits[i : i + 3], 2) for i in range(0, len(bits) - 2, 3)]
    ti = bi = 0

    def string():
        nonlocal offset
        offset, length = _read(data, offset)
        result = data[offset : offset + length].decode()
        offset += length
        return result

    def decode(depth=0):
        nonlocal offset, ti, bi
        if depth > 500:
            raise ValueError("JSON value is too deep")
        kind = types[ti]
        ti += 1
        if kind == 0:
            return None
        if kind == 1:
            result = bools[bi]
            bi += 1
            return result
        if kind == 2:
            offset, value = _read(data, offset)
            return (value >> 1) ^ -(value & 1)
        if kind == 3:
            result = struct.unpack(">f", data[offset : offset + 4])[0]
            offset += 4
            return result
        if kind == 4:
            return string()
        if kind == 5:
            offset, length = _read(data, offset)
            return [decode(depth + 1) for _ in range(length)]
        if kind == 6:
            offset, length = _read(data, offset)
            return {string(): decode(depth + 1) for _ in range(length)}
        raise ValueError(f"unknown JSON type {kind}")

    return decode()


compressJSON = compress_json
decompressJSON = decompress_json
