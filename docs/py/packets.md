# Python packet schemas

Python accepts camelCase TypeScript setting names and snake_case equivalents. Define identical logical packet arrays on a server; clients learn both arrays from the wire handshake.

## Packet types

`PacketType` contains `NONE`, `RAW`, `STRINGS_ASCII` (`STRINGS` alias), `STRINGS_UTF16`, `ENUMS`, `BYTES`, `UBYTES`, `SHORTS`, `USHORTS`, `VARINT`, `UVARINT`, `DELTAS`, `FLOATS`, `DOUBLES`, `BOOLEANS`, reserved `KEY_EFFECTIVE`, `JSON`, and `HEX`.

- `RAW` accepts bytes-like objects and returns `bytes`.
- ASCII uses the protocol Huffman table and only supports byte-range characters.
- UTF16 supports all valid Unicode scalar values.
- integer types enforce their signed/unsigned ranges in Rust.
- `FLOATS` decodes binary32 approximations; `DOUBLES` uses binary64.
- `HEX` accepts exactly one even-length hexadecimal string.
- `JSON` is encoded in Python, then carried opaquely by the Rust reserved type.
- `KEY_EFFECTIVE` is reserved and unsupported in both languages.

## Constructors

```py
create_packet(
    tag="position",
    type=PacketType.FLOATS,
    dataMin=3,
    dataMax=3,
    async_=True,
    dataBatching=10,
    maxBatchSize=20,
    gzipCompression=False,
    rateLimit=60,
    enabled=True,
    dontSpread=False,
    rereference=False,
    validator=None,
)
```

`noDataRange=True` selects the protocol-wide range. Use `async_=True` in keyword-call syntax (`{"async": True}` also works in a settings dictionary). Numeric data limits are clamped to 0…2,048,383 like TypeScript. Rate limits accept 1…65,535; zero or a larger value means unlimited. Rereference requires a nonzero minimum. `dataBatching` must fit in one byte because it is serialized in the schema.

Object packets use `types`, `dataMins`, and `dataMaxes`; scalar min/max values are repeated for every sector. Prefer `autoTranspose=True` with a schema for repeated records. Legacy `autoFlatten=True` still transposes positional rows into sectors. Objects do not support rereference.

`CreatePacket`, `CreateObjPacket`, and `CreateEnumPacket` are aliases.

## Schemas, layouts, and quantization

Python accepts the same metadata as TypeScript:

```py
movement = CreatePacket(
    tag="movementMove",
    type=PacketType.SHORTS,
    schema=["dx", "dy", "dz"],
    dataMin=3,
    dataMax=3,
    quantized={"scale": 32767, "trackError": True},
    min=-1,
    max=1,
)
await socket.send("movementMove", {"dx": .5, "dy": 0, "dz": -.5})
```

All fields are required and extras are rejected. Positional sends remain valid and encode identically. Schema listeners receive one dictionary. `min` and `max` validate application-level values in both directions. Quantization rounds on send and divides on receive. `trackError` defaults to true and carries each rounding residual into the next value for that packet and connection; set it to false for stateless rounding.

Homogeneous `autoFlatten=True` maps fixed-width dictionaries to row-major values. Object `autoTranspose=True` maps repeated dictionaries to column-major sectors; object `autoFlatten=True` remains an alias. Non-divisible homogeneous payloads are rejected. Variable-width records are not implemented.

`CreatePacketGroup(...)` returns child packets to include in a packet list. Use `send_variant`/`sendVariant`; listeners may subscribe to `movement.move` or to `movement`, whose event is `{"variant": "move", "payload": ...}`.

## Values and listener spreading

Ordinary packet listeners receive positional values. With `dontSpread=True`, they receive one collection. Each object field is normalized to a collection and checked against its own range. `NONE` sends no values. A RAW bytes object should be passed as the single argument.

## Enums

```py
color = define_enum("color", ["red", "green", "blue", None, Undefined])
packet = create_enum_packet(tag="color", enumData=color)
await client.send("color", wrap_enum("color", "green"))
```

Enum matching is type-strict: `True` is not integer `1`. `float("nan")` matches an enum NaN. `Undefined` is a singleton used to represent JavaScript `undefined`; Python `None` represents JavaScript `null`. `dewrap_enum` reverses an index.

## JSON mapping

Python JSONUtil supports `None`, booleans, integers, IEEE numbers, strings, lists/tuples, and dictionaries, matching TypeScript JSONUtil. JSON object keys are always strings: Python converts every dictionary key with `str()`, and insertion order determines wire order. Do not use key order as a semantic contract across independently constructed objects. `Undefined` and bytes are enum/RAW values, not JSON values. Decoding produces native Python objects. This is a binary SonicWS object format, not UTF-8 JSON text, and nesting is limited to 500 levels.

## Batching, compression, and rereference

Batching collects sends of one packet for `dataBatching` milliseconds. Each item is length-framed; an empty item is valid. `gzipCompression` is the historical setting name but means raw DEFLATE. Compressed batch expansion is bounded. Rereference caches the last value per connection and sends an empty payload for equality; an empty first value is invalid.
