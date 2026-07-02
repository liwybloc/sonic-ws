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

from dataclasses import dataclass, field
from typing import Any, Callable, Sequence
import warnings
from .packet_type import PacketType
from .enums import EnumPackage, Undefined, define_enum
from .codec import (
    encode_value,
    decode_value,
    frame_object,
    unframe_object,
    deflate,
    inflate,
)
from .jsonutil import compress_json, decompress_json

MAX_DATA_MAX = 2_048_383
MAX_RATE_LIMIT = 65_535


def varint(value: int) -> bytes:
    out = bytearray()
    while True:
        b = value & 127
        value >>= 7
        out.append(b | (128 if value else 0))
        if not value:
            return bytes(out)


def read_varint(data: bytes, offset=0):
    value = shift = 0
    while offset < len(data):
        b = data[offset]
        offset += 1
        value |= (b & 127) << shift
        if not b & 128:
            return offset, value
        shift += 7
        if shift > 63:
            break
    raise ValueError("invalid varint")


def flatten_data(rows):
    if rows is None or not rows:
        return []
    if not isinstance(rows[0], (list, tuple)):
        raise ValueError(f"Cannot flatten array: {rows!r}")
    return [list(column) for column in zip(*rows)]


def unflatten_data(columns):
    return [list(row) for row in zip(*columns)] if columns else []


@dataclass
class Packet:
    tag: str
    types: tuple[PacketType, ...]
    data_mins: tuple[int, ...]
    data_maxes: tuple[int, ...]
    enum_data: tuple[EnumPackage, ...] = ()
    is_object: bool = False
    dont_spread: bool = False
    asynchronous: bool = False
    auto_flatten: bool = False
    rereference: bool = False
    data_batching: int = 0
    max_batch_size: int = 10
    gzip_compression: bool = False
    rate_limit: int = 0
    default_enabled: bool = True
    validator: Callable[..., bool] | None = None
    client: bool = False
    last_sent: dict[int, Any] = field(default_factory=dict)
    last_received: dict[int, Any] = field(default_factory=dict)

    @property
    def object(self):
        return self.is_object

    @property
    def type(self):
        return self.types if self.object else self.types[0]

    @property
    def data_min(self):
        return self.data_mins if self.object else self.data_mins[0]

    @property
    def data_max(self):
        return self.data_maxes if self.object else self.data_maxes[0]

    @property
    def min_size(self):
        return len(self.types) if self.object else self.data_mins[0]

    @property
    def max_size(self):
        return len(self.types) if self.object else self.data_maxes[0]

    def encode(self, values: Sequence[Any]) -> bytes:
        if self.object:
            if len(values) != len(self.types):
                raise ValueError("object field count mismatch")
            values = list(values)
            if not self.auto_flatten:
                for index, value in enumerate(values):
                    if not isinstance(value, (list, tuple)):
                        value = [value]
                        values[index] = value
                    if not self.data_mins[index] <= len(value) <= self.data_maxes[index]:
                        raise ValueError(f"object field {index} count outside schema limits")
            sectors, enum_index = [], 0
            for index, kind in enumerate(self.types):
                package = (
                    self.enum_data[enum_index] if kind == PacketType.ENUMS else None
                )
                if package:
                    enum_index += 1
                field = values[index]
                sectors.append(
                    compress_json(field)
                    if kind == PacketType.JSON
                    else encode_value(kind, field, package)
                )
            result = frame_object(sectors)
        else:
            kind = self.types[0]
            count = 0 if kind == PacketType.NONE else len(values)
            if kind not in (PacketType.RAW, PacketType.JSON) and not self.data_mins[0] <= count <= self.data_maxes[0]:
                raise ValueError("value count outside schema limits")
            if kind == PacketType.JSON:
                result = compress_json(list(values))
            elif (
                kind == PacketType.RAW
                and len(values) == 1
                and isinstance(values[0], (bytes, bytearray, memoryview))
            ):
                result = encode_value(kind, values[0])
            else:
                result = encode_value(
                    kind, list(values), self.enum_data[0] if self.enum_data else None
                )
        return (
            deflate(result)
            if self.gzip_compression and not self.data_batching
            else result
        )

    def decode(self, data: bytes):
        raw = (
            inflate(data) if self.gzip_compression and not self.data_batching else data
        )
        if self.object:
            sectors = unframe_object(raw, len(self.types))
            values, enum_index = [], 0
            for index, (kind, sector) in enumerate(zip(self.types, sectors)):
                package = (
                    self.enum_data[enum_index] if kind == PacketType.ENUMS else None
                )
                if package:
                    enum_index += 1
                value = (
                    decompress_json(sector)
                    if kind == PacketType.JSON
                    else decode_value(kind, sector, self.data_maxes[index], package)
                )
                count = len(value) if isinstance(value, (list, tuple)) else 1
                if not self.data_mins[index] <= count <= self.data_maxes[index]:
                    raise ValueError("value count outside schema limits")
                values.append(value)
        else:
            kind = self.types[0]
            values = (
                decompress_json(raw)
                if kind == PacketType.JSON
                else decode_value(
                    kind,
                    raw,
                    self.data_maxes[0],
                    self.enum_data[0] if self.enum_data else None,
                )
            )
            count = (
                0
                if kind == PacketType.NONE
                else (len(values) if isinstance(values, (list, tuple)) else 1)
            )
            if (
                kind != PacketType.RAW
                and not self.data_mins[0] <= count <= self.data_maxes[0]
            ):
                raise ValueError("value count outside schema limits")
        values = unflatten_data(values) if self.auto_flatten else values
        return values

    def serialize(self) -> bytes:
        flags = [
            self.dont_spread,
            self.asynchronous,
            self.object,
            self.auto_flatten,
            self.gzip_compression,
            self.rereference,
        ]
        flag_byte = sum(int(v) << (7 - i) for i, v in enumerate(flags))
        tag = self.tag.encode("latin1")
        shared = (
            bytes([len(tag)])
            + tag
            + bytes([flag_byte, self.data_batching, len(self.enum_data)])
            + b"".join(e.serialize() for e in self.enum_data)
        )
        if not self.object:
            return (
                shared
                + varint(self.data_maxes[0])
                + varint(self.data_mins[0])
                + bytes([self.types[0]])
            )
        return (
            shared
            + bytes([len(self.types)])
            + b"".join(map(varint, self.data_maxes))
            + b"".join(map(varint, self.data_mins))
            + bytes(self.types)
        )

    @classmethod
    def deserialize(cls, data: bytes, offset=0, client=True):
        start = offset
        length = data[offset]
        offset += 1
        tag = data[offset : offset + length].decode("latin1")
        offset += length
        flags = data[offset]
        offset += 1
        dont, asynchronous, obj, auto, gzip, reref = [
            bool(flags & (1 << (7 - i))) for i in range(6)
        ]
        batching, enum_count = data[offset], data[offset + 1]
        offset += 2
        enums = []
        for _ in range(enum_count):
            length = data[offset]
            offset += 1
            name = data[offset : offset + length].decode("latin1")
            offset += length
            count = data[offset]
            offset += 1
            values = []
            for _ in range(count):
                length, kind = data[offset], data[offset + 1]
                offset += 2
                text = data[offset : offset + length].decode("latin1")
                offset += length
                values.append(
                    text
                    if kind == 0
                    else (
                        float(text)
                        if kind == 1 and "." in text
                        else (
                            int(text)
                            if kind == 1
                            else (
                                text == "true"
                                if kind == 2
                                else Undefined if kind == 3 else None
                            )
                        )
                    )
                )
            enums.append(define_enum(name, values))
        if obj:
            size = data[offset]
            offset += 1
            maxes = []
            mins = []
            for target in (maxes, mins):
                for _ in range(size):
                    offset, value = read_varint(data, offset)
                    target.append(value)
            types = tuple(PacketType(v) for v in data[offset : offset + size])
            offset += size
        else:
            offset, maximum = read_varint(data, offset)
            offset, minimum = read_varint(data, offset)
            types = (PacketType(data[offset]),)
            offset += 1
            mins = [minimum]
            maxes = [maximum]
        return (
            cls(
                tag=tag,
                types=types,
                data_mins=tuple(mins),
                data_maxes=tuple(maxes),
                enum_data=tuple(enums),
                is_object=obj,
                dont_spread=dont,
                asynchronous=asynchronous,
                auto_flatten=auto,
                rereference=reref,
                data_batching=batching,
                max_batch_size=0 if client else 10,
                gzip_compression=gzip,
                client=client,
            ),
            offset - start,
        )


def _settings(settings, kwargs):
    result = dict(settings or {})
    result.update(kwargs)
    return result


def _data_max(value):
    value = int(value)
    if value < 0:
        warnings.warn("A data maximum below 0 was clamped to 0", stacklevel=3)
        return 0
    if value > MAX_DATA_MAX:
        warnings.warn(f"A data maximum was clamped to {MAX_DATA_MAX}", stacklevel=3)
        return MAX_DATA_MAX
    return value


def _data_min(value, maximum, kind=None):
    if kind == PacketType.NONE:
        return 0
    value = int(value)
    if value < 0:
        warnings.warn("A data minimum below 0 was clamped to 0", stacklevel=3)
        return 0
    if value > maximum:
        warnings.warn("A data minimum above its maximum was clamped", stacklevel=3)
        return maximum
    return value


def _common(s, *, default_gzip=False):
    batching = int(s.pop("dataBatching", s.pop("data_batching", 0)))
    max_batch = int(s.pop("maxBatchSize", s.pop("max_batch_size", 10)))
    rate = int(s.pop("rateLimit", s.pop("rate_limit", 0)))
    if not 0 <= batching <= 255:
        raise ValueError("dataBatching must fit in one byte (0..255)")
    if max_batch < 0:
        raise ValueError("maxBatchSize cannot be negative")
    if rate < 0:
        raise ValueError("rateLimit cannot be negative")
    if rate > MAX_RATE_LIMIT:
        warnings.warn(
            f"A rate limit above {MAX_RATE_LIMIT} is considered unlimited",
            stacklevel=3,
        )
        rate = 0
    return dict(
        dont_spread=bool(s.pop("dontSpread", s.pop("dont_spread", False))),
        asynchronous=bool(s.pop("async", s.pop("async_", s.pop("asynchronous", False)))),
        data_batching=batching,
        max_batch_size=max_batch,
        gzip_compression=bool(s.pop("gzipCompression", s.pop("gzip_compression", default_gzip))),
        rate_limit=rate,
        default_enabled=bool(s.pop("enabled", s.pop("default_enabled", True))),
        validator=s.pop("validator", None),
    )


def _finish(s):
    if s:
        raise TypeError(f"Unknown packet settings: {', '.join(sorted(s))}")


def create_packet(settings=None, **kwargs):
    s = _settings(settings, kwargs)
    tag = s.pop("tag")
    value = s.pop("type", PacketType.NONE)
    enum = value if isinstance(value, EnumPackage) else None
    kind = PacketType.ENUMS if enum else PacketType(value)
    no_range = bool(s.pop("noDataRange", s.pop("no_data_range", False)))
    rereference = bool(s.pop("rereference", False))
    maximum = MAX_DATA_MAX if no_range else _data_max(s.pop("dataMax", s.pop("data_max", 1)))
    default_min = 1 if "dataMax" not in s and "data_max" not in s else maximum
    minimum = 1 if no_range and rereference else (0 if no_range else s.pop("dataMin", s.pop("data_min", 0 if kind == PacketType.NONE else default_min)))
    minimum = _data_min(minimum, maximum, kind)
    if rereference and minimum == 0:
        raise ValueError("rereference cannot be enabled when dataMin is 0")
    common = _common(s, default_gzip=kind == PacketType.JSON)
    packet = Packet(
        tag=tag,
        types=(kind,),
        data_mins=(minimum,),
        data_maxes=(maximum,),
        enum_data=(enum,) if enum else (),
        rereference=rereference,
        **common,
    )
    _finish(s)
    return packet


def create_obj_packet(settings=None, **kwargs):
    s = _settings(settings, kwargs)
    tag = s.pop("tag")
    input_types = s.pop("types")
    enums = []
    types = []
    for value in input_types:
        types.append(
            PacketType.ENUMS if isinstance(value, EnumPackage) else PacketType(value)
        )
        enums.extend([value] if isinstance(value, EnumPackage) else [])
    n = len(types)
    if n == 0:
        raise ValueError("types cannot be empty")
    no_range = bool(s.pop("noDataRange", s.pop("no_data_range", False)))
    maxes = [MAX_DATA_MAX] * n if no_range else s.pop("dataMaxes", s.pop("data_maxes", [1] * n))
    maxes = [maxes] * n if isinstance(maxes, int) else list(maxes)
    mins = [0] * n if no_range else s.pop("dataMins", s.pop("data_mins", maxes))
    mins = [mins] * n if isinstance(mins, int) else list(mins)
    if len(maxes) != n or len(mins) != n:
        raise ValueError("dataMaxes and dataMins must match the number of types")
    maxes = [_data_max(v) for v in maxes]
    mins = [_data_min(v, maxes[i], types[i]) for i, v in enumerate(mins)]
    common = _common(s, default_gzip=PacketType.JSON in types)
    auto_flatten = bool(s.pop("autoFlatten", s.pop("auto_flatten", False)))
    packet = Packet(
        tag=tag,
        types=tuple(types),
        data_mins=tuple(mins),
        data_maxes=tuple(maxes),
        enum_data=tuple(enums),
        is_object=True,
        auto_flatten=auto_flatten,
        **common,
    )
    _finish(s)
    return packet


def create_enum_packet(settings=None, **kwargs):
    s = _settings(settings, kwargs)
    s["type"] = s.pop("enumData", s.pop("enum_data", None))
    return create_packet(s)


CreatePacket = create_packet
CreateObjPacket = create_obj_packet
CreateEnumPacket = create_enum_packet
FlattenData = flatten_data
UnFlattenData = unflatten_data
