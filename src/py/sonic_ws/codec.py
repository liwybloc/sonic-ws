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

from typing import Any, Sequence
from .packet_type import PacketType
from .enums import EnumPackage, enum_index
from . import _core


def encode_value(
    kind: PacketType, value: Any, enum: EnumPackage | None = None
) -> bytes:
    kind = PacketType(kind)
    values = value if isinstance(value, (list, tuple)) else [value]

    match kind:
        case PacketType.NONE:
            return b""

        case PacketType.RAW | PacketType.JSON:
            return bytes(value)

        case (
            PacketType.BYTES
            | PacketType.SHORTS
            | PacketType.VARINT
            | PacketType.DELTAS
        ):
            return bytes(_core.encode_signed(kind, values))

        case PacketType.UBYTES | PacketType.USHORTS | PacketType.UVARINT:
            return bytes(_core.encode_unsigned(kind, values))

        case PacketType.FLOATS | PacketType.DOUBLES:
            return bytes(_core.encode_floats(kind, values))

        case PacketType.STRINGS_ASCII | PacketType.STRINGS_UTF16:
            return bytes(_core.encode_strings(kind, values))

        case PacketType.BOOLEANS:
            return bytes(_core.encode_booleans(values))

        case PacketType.HEX:
            return bytes(_core.encode_hex(values[0]))

        case PacketType.ENUMS:
            if enum is None:
                raise ValueError("ENUMS requires an EnumPackage")

            return bytes(
                item
                if isinstance(item, int)
                and not isinstance(item, bool)
                and 0 <= item < len(enum.values)
                else enum_index(enum.values, item)
                for item in values
            )

        case _:
            raise NotImplementedError(kind)


def decode_value(
    kind: PacketType, data: bytes, maximum: int, enum: EnumPackage | None = None
) -> Any:
    kind = PacketType(kind)

    match kind:
        case PacketType.NONE:
            if data:
                raise ValueError("NONE packet contains data")
            return None

        case PacketType.RAW | PacketType.JSON:
            return bytes(_core.decode_raw(data))

        case (
            PacketType.BYTES
            | PacketType.SHORTS
            | PacketType.VARINT
            | PacketType.DELTAS
        ):
            return _core.decode_signed(kind, data)

        case PacketType.UBYTES | PacketType.USHORTS | PacketType.UVARINT:
            return _core.decode_unsigned(kind, data)

        case PacketType.FLOATS | PacketType.DOUBLES:
            return _core.decode_floats(kind, data)

        case PacketType.STRINGS_ASCII | PacketType.STRINGS_UTF16:
            return _core.decode_strings(kind, data)

        case PacketType.BOOLEANS:
            return _core.decode_booleans(data, maximum)

        case PacketType.HEX:
            return _core.decode_hex(data)

        case PacketType.ENUMS:
            if enum is None:
                raise ValueError("ENUMS requires an EnumPackage")

            return [enum.values[index] for index in data]

        case _:
            raise NotImplementedError(kind)

def frame_object(sectors: Sequence[bytes]) -> bytes:
    return bytes(_core.frame_object(list(sectors)))


def unframe_object(data: bytes, count: int) -> list[bytes]:
    return [bytes(v) for v in _core.unframe_object(data, count)]


def encode_batch(values: Sequence[bytes], compressed=False) -> bytes:
    return bytes(_core.encode_batch(list(values), compressed))


def decode_batch(data: bytes, compressed=False, maximum=0) -> list[bytes]:
    return [bytes(v) for v in _core.decode_batch(data, compressed, maximum)]


def deflate(data: bytes) -> bytes:
    return bytes(_core.deflate_raw(data))


def inflate(data: bytes, maximum=None) -> bytes:
    return bytes(_core.inflate_raw(data, maximum))
