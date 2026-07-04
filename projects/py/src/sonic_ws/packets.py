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
import json
import math
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
_PACKET_CONSTRUCTORS = {}


def register_packet_constructor(constructor):
    name = constructor.__name__
    if not name:
        raise ValueError("packet constructors must have a stable class name")
    existing = _PACKET_CONSTRUCTORS.get(name)
    if existing is not None and existing is not constructor:
        raise ValueError(f'a different packet constructor named "{name}" is already registered')
    _PACKET_CONSTRUCTORS[name] = constructor
    return constructor


def unregister_packet_constructor(name):
    _PACKET_CONSTRUCTORS.pop(name, None)


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
    quantization_errors: dict[int, float] = field(default_factory=dict, repr=False)
    schema: tuple[str, ...] | None = None
    quantized: dict[str, Any] | None = None
    value_min: float | None = None
    value_max: float | None = None
    group_parent: str | None = None
    group_variant: str | None = None
    is_parent: bool = False
    constructor_name: str | None = None
    replay: bool = False

    def __post_init__(self):
        if self.quantized is not None:
            self.quantized = dict(self.quantized)
            self.quantized.setdefault("trackError", True)

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

    @property
    def auto_transpose(self):
        return self.auto_flatten if self.object else False

    @property
    def parent(self):
        return self.group_parent

    @property
    def variant(self):
        return self.group_variant

    def _record(self, record, context):
        if not self.schema or record is None:
            raise ValueError(f'Packet "{self.tag}" {context} requires an object record')
        mapping = record if isinstance(record, dict) else None
        missing = [name for name in self.schema if name not in mapping] if mapping is not None else [name for name in self.schema if not hasattr(record, name)]
        extra = [name for name in mapping if name not in self.schema] if mapping is not None else []
        if missing:
            raise ValueError(f'Packet "{self.tag}" is missing schema field(s): {", ".join(missing)}')
        if extra:
            raise ValueError(f'Packet "{self.tag}" has unknown schema field(s): {", ".join(extra)}')
        return [mapping[name] if mapping is not None else getattr(record, name) for name in self.schema]

    def _construct(self, values):
        if not self.constructor_name:
            return values
        try:
            constructor = _PACKET_CONSTRUCTORS[self.constructor_name]
        except KeyError as error:
            raise ValueError(
                f'packet constructor "{self.constructor_name}" is not registered locally; '
                f'call register_packet_constructor({self.constructor_name}) before decoding'
            ) from error
        return constructor(values)

    def _numbers(self, values, direction, state_key=-1):
        scale = self.quantized.get("scale") if self.quantized else None
        result = []
        for value in values:
            if not isinstance(value, (int, float)) or isinstance(value, bool) or not math.isfinite(value):
                raise ValueError(f'Packet "{self.tag}" {direction} value must be a finite number')
            logical = value / scale if direction == "receive" and scale else value
            if self.value_min is not None and logical < self.value_min:
                raise ValueError(f'Packet "{self.tag}" value {logical} is below minimum {self.value_min}')
            if self.value_max is not None and logical > self.value_max:
                raise ValueError(f'Packet "{self.tag}" value {logical} exceeds maximum {self.value_max}')
            if direction == "send" and scale:
                residual = self.quantization_errors.get(state_key, 0.0) if self.quantized.get("trackError", True) else 0.0
                adjusted = logical * scale + residual
                wire = math.floor(adjusted + 0.5)
                if self.quantized.get("trackError", True):
                    self.quantization_errors[state_key] = adjusted - wire
                result.append(wire)
            else:
                result.append(logical)
        return result

    def prepare_send(self, values, state_key=-1):
        values = list(values)
        if self.object:
            if self.auto_flatten and self.schema:
                if len(values) != 1 or not isinstance(values[0], (list, tuple)):
                    raise ValueError(f'Packet "{self.tag}" autoTranspose requires one array of records')
                rows = [self._record(row, "autoTranspose") for row in values[0]]
                return [[row[column] for row in rows] for column in range(len(self.schema))]
            if self.auto_flatten:
                return flatten_data(values[0])
            return values
        if self.auto_flatten:
            if len(values) != 1 or not isinstance(values[0], (list, tuple)):
                raise ValueError(f'Packet "{self.tag}" autoFlatten requires one array of records')
            values = [item for row in values[0] for item in self._record(row, "autoFlatten")]
        elif self.schema and len(values) == 1 and (
            isinstance(values[0], dict)
            or (self.constructor_name and not isinstance(values[0], (list, tuple, str, bytes, bytearray, int, float, bool)))
        ):
            values = self._record(values[0], "schema mapping")
        if self.quantized or self.value_min is not None or self.value_max is not None:
            values = self._numbers(values, "send", state_key)
        return values

    def finish_receive(self, values):
        if self.object:
            if self.auto_flatten and self.schema:
                count = len(values[0]) if values else 0
                if any(len(column) != count for column in values):
                    raise ValueError(f'Packet "{self.tag}" autoTranspose columns have different lengths')
                return [self._construct({name: values[column][row] for column, name in enumerate(self.schema)}) for row in range(count)]
            return unflatten_data(values) if self.auto_flatten else values
        decoded = list(values) if isinstance(values, (list, tuple)) else [values]
        if self.quantized or self.value_min is not None or self.value_max is not None:
            decoded = self._numbers(decoded, "receive")
        if self.auto_flatten:
            width = len(self.schema)
            if len(decoded) % width:
                raise ValueError(f'Packet "{self.tag}" flat value count {len(decoded)} is not divisible by schema length {width}')
            return [self._construct({name: decoded[row * width + column] for column, name in enumerate(self.schema)}) for row in range(len(decoded) // width)]
        if self.schema:
            return self._construct(dict(zip(self.schema, decoded)))
        return values

    def encode(self, values: Sequence[Any], state_key=-1) -> bytes:
        values = self.prepare_send(values, state_key)
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
        result = self.finish_receive(values)
        return {"variant": "", "payload": result} if self.is_parent else result

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
        metadata = json.dumps({
            "schema": self.schema,
            "quantized": self.quantized,
            "min": self.value_min,
            "max": self.value_max,
            "group": ({"parent": self.group_parent, "variant": self.group_variant or "", "isParent": self.is_parent} if self.group_parent is not None else None),
            "constructor": self.constructor_name,
            "replay": self.replay or None,
        }, separators=(",", ":")).encode()
        shared = (
            bytes([len(tag)])
            + tag
            + bytes([flag_byte]) + varint(len(metadata)) + metadata
            + bytes([self.data_batching, len(self.enum_data)])
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
        offset, metadata_length = read_varint(data, offset)
        metadata = json.loads(data[offset : offset + metadata_length])
        offset += metadata_length
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
                schema=tuple(metadata["schema"]) if metadata.get("schema") else None,
                quantized=metadata.get("quantized"),
                value_min=metadata.get("min"),
                value_max=metadata.get("max"),
                group_parent=(metadata.get("group") or {}).get("parent"),
                group_variant=(metadata.get("group") or {}).get("variant"),
                is_parent=bool((metadata.get("group") or {}).get("isParent", False)),
                constructor_name=metadata.get("constructor"),
                replay=bool(metadata.get("replay", False)),
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
        replay=bool(s.pop("replay", False)),
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
    fields = s.pop("schema", None)
    fields = tuple(fields) if fields is not None else None
    auto_flatten = bool(s.pop("autoFlatten", s.pop("auto_flatten", False)))
    repeated_default = auto_flatten and "dataMax" not in s and "data_max" not in s and "dataMin" not in s and "data_min" not in s
    no_range = bool(s.pop("noDataRange", s.pop("no_data_range", False))) or repeated_default
    rereference = bool(s.pop("rereference", False))
    quantized = s.pop("quantized", None)
    packet_constructor = s.pop("constructor", None)
    value_min = s.pop("min", None)
    value_max = s.pop("max", None)
    maximum = MAX_DATA_MAX if no_range else _data_max(s.pop("dataMax", s.pop("data_max", 1)))
    minimum = 1 if no_range and rereference else (0 if no_range else s.pop("dataMin", s.pop("data_min", 0 if kind == PacketType.NONE else maximum)))
    minimum = _data_min(minimum, maximum, kind)
    if rereference and minimum == 0:
        raise ValueError("rereference cannot be enabled when dataMin is 0")
    _validate_schema(fields, tag)
    if packet_constructor is not None and not fields:
        raise ValueError(f'Packet "{tag}" constructor requires schema')
    if packet_constructor is not None:
        register_packet_constructor(packet_constructor)
    if auto_flatten and not fields:
        raise ValueError(f'Packet "{tag}" autoFlatten requires schema')
    if fields and not auto_flatten and minimum == maximum and len(fields) != maximum:
        raise ValueError(f'Packet "{tag}" schema length must match its fixed value count ({maximum})')
    numeric = kind in {PacketType.BYTES, PacketType.UBYTES, PacketType.SHORTS, PacketType.USHORTS, PacketType.VARINT, PacketType.UVARINT, PacketType.DELTAS, PacketType.FLOATS, PacketType.DOUBLES}
    if (quantized is not None or value_min is not None or value_max is not None) and not numeric:
        raise ValueError(f'Packet "{tag}" numeric options require a numeric packet type')
    if quantized is not None and (not math.isfinite(quantized.get("scale", 0)) or quantized.get("scale", 0) <= 0):
        raise ValueError(f'Packet "{tag}" quantization scale must be positive and finite')
    if value_min is not None and value_max is not None and value_min > value_max:
        raise ValueError(f'Packet "{tag}" min cannot exceed max')
    common = _common(s, default_gzip=kind == PacketType.JSON)
    if common["replay"] and common["data_batching"]:
        raise ValueError(f'Packet "{tag}" cannot combine replay with batching')
    packet = Packet(
        tag=tag,
        types=(kind,),
        data_mins=(minimum,),
        data_maxes=(maximum,),
        enum_data=(enum,) if enum else (),
        rereference=rereference,
        schema=fields,
        auto_flatten=auto_flatten,
        quantized=dict(quantized) if quantized else None,
        value_min=value_min,
        value_max=value_max,
        constructor_name=packet_constructor.__name__ if packet_constructor else None,
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
    fields = s.pop("schema", None)
    packet_constructor = s.pop("constructor", None)
    fields = tuple(fields) if fields is not None else None
    _validate_schema(fields, tag)
    if packet_constructor is not None and not fields:
        raise ValueError(f'Packet "{tag}" constructor requires schema')
    if packet_constructor is not None:
        register_packet_constructor(packet_constructor)
    if fields and len(fields) != n:
        raise ValueError(f'Packet "{tag}" schema length must match types length')
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
    if common["replay"] and common["data_batching"]:
        raise ValueError(f'Packet "{tag}" cannot combine replay with batching')
    old_auto = s.pop("autoFlatten", s.pop("auto_flatten", None))
    transpose = s.pop("autoTranspose", s.pop("auto_transpose", None))
    if old_auto is not None and transpose is not None and bool(old_auto) != bool(transpose):
        raise ValueError(f'Packet "{tag}" has conflicting autoFlatten and autoTranspose options')
    auto_flatten = bool(transpose if transpose is not None else old_auto)
    packet = Packet(
        tag=tag,
        types=tuple(types),
        data_mins=tuple(mins),
        data_maxes=tuple(maxes),
        enum_data=tuple(enums),
        is_object=True,
        auto_flatten=auto_flatten,
        schema=fields,
        constructor_name=packet_constructor.__name__ if packet_constructor else None,
        **common,
    )
    _finish(s)
    return packet


def create_enum_packet(settings=None, **kwargs):
    s = _settings(settings, kwargs)
    s["type"] = s.pop("enumData", s.pop("enum_data", None))
    return create_packet(s)


def _validate_schema(fields, tag):
    if fields is None:
        return
    if not fields or any(not isinstance(name, str) or not name for name in fields):
        raise ValueError(f'Packet "{tag}" schema must contain non-empty field names')
    if len(set(fields)) != len(fields):
        raise ValueError(f'Packet "{tag}" schema fields must be unique')


def create_packet_group(settings=None, **kwargs):
    s = _settings(settings, kwargs)
    tag = s.pop("tag")
    variants = s.pop("variants")
    _finish(s)
    if not tag or "$" in tag:
        raise ValueError("Packet group tag is required and cannot contain '$'")
    if not variants:
        raise ValueError(f'Packet group "{tag}" requires at least one variant')
    packets = [create_packet(
        tag=tag,
        type=PacketType.NONE,
        dataMin=0,
        dataMax=0,
    )]
    packets[0].group_parent = tag
    packets[0].group_variant = ""
    packets[0].is_parent = True
    for variant, definition in variants.items():
        if not variant or "$" in variant:
            raise ValueError("Packet variant names cannot be empty or contain '$'")
        child = create_packet({**definition, "tag": f"{tag}.{variant}"})
        child.group_parent = tag
        child.group_variant = variant
        packets.append(child)
    return packets


CreatePacket = create_packet
CreateObjPacket = create_obj_packet
CreateEnumPacket = create_enum_packet
CreatePacketGroup = create_packet_group
FlattenData = flatten_data
UnFlattenData = unflatten_data
RegisterPacketConstructor = register_packet_constructor
UnregisterPacketConstructor = unregister_packet_constructor
