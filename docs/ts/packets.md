# TypeScript packet schemas

Both sides must define what they may send. `clientPackets` travel client → server; `serverPackets` travel server → client. Packet tags are local names exchanged in the handshake. Wire packet key `0` is reserved, leaving 254 usable packet definitions per direction.

## Packet types

| Type | Values | Notes |
|---|---|---|
| `NONE` | no values | Empty payload only. |
| `RAW` | `Uint8Array` or byte array | Opaque bytes; no transformation. |
| `STRINGS_ASCII` / `STRINGS` | strings using byte characters | Huffman-coded legacy 0–255 character table. Use UTF16 for other code points. |
| `STRINGS_UTF16` | Unicode strings | Encodes Unicode scalar values, including astral characters. |
| `ENUMS` | values from an `EnumPackage` | Supports strings, numbers, booleans, `null`, and `undefined`. |
| `BYTES` | -128…127 integers | Zigzag encoded. |
| `UBYTES` | 0…255 integers | Unsigned. |
| `SHORTS` | -32768…32767 integers | Big-endian zigzag values. |
| `USHORTS` | 0…65535 integers | Big-endian unsigned values. |
| `VARINT` | signed integers | Zigzag variable-width integers. |
| `UVARINT` | nonnegative integers | Variable-width integers. |
| `DELTAS` | signed integer sequence | First value plus signed differences. Useful for nearby values. |
| `FLOATS` | numbers | IEEE-754 binary32; expect `Math.fround` precision. |
| `DOUBLES` | numbers | IEEE-754 binary64. |
| `BOOLEANS` | booleans | MSB-first bit packing. The schema count determines padding. |
| `KEY_EFFECTIVE` | — | Reserved and currently unsupported. |
| `JSON` | any JSONUtil-supported value | JavaScript codec carried as opaque reserved-type bytes. |
| `HEX` | one hexadecimal string | Even length; decoded lowercase. |

## `CreatePacket(settings)`

Required: `tag`. `type` defaults to `NONE`. Settings:

- `dataMin`, `dataMax`: accepted value-count range. `dataMax` defaults to 1. `NONE` always uses zero.
- `noDataRange`: sets the range to the protocol maximum; with rereference the minimum stays 1.
- `dontSpread`: listeners receive one array rather than positional values.
- `async`: this tag may execute alongside other tags; invocations of the same tag remain ordered.
- `rereference`: repeated values may be represented by an empty payload. It requires `dataMin > 0` and is not valid for server-wide broadcast.
- `dataBatching`: milliseconds to collect sends before framing them as one WebSocket message. Zero disables batching.
- `maxBatchSize`: maximum received items in one batch; zero means unlimited where supported.
- `gzipCompression`: legacy name for raw DEFLATE, not a gzip container. Defaults on for JSON.
- `rateLimit`: per-second limit stored in the 0…65,535 range; zero or a larger value means unlimited.
- `enabled`: whether clients may send this packet initially.
- `validator(socket, ...values)`: server-side application validation. Return false to reject the packet.

## Objects

`CreateObjPacket` frames one independently encoded sector per type.

```ts
const state = CreateObjPacket({
  tag: "state",
  types: [PacketType.STRINGS_UTF16, PacketType.BOOLEANS, PacketType.UVARINT],
  dataMins: [1, 1, 3],
  dataMaxes: [1, 1, 3],
  dontSpread: true,
});
```

`dataMins` and `dataMaxes` accept either one number for every sector or one number per type. `autoFlatten` transposes row-shaped data before sending and reverses it after decoding. Object enums consume enum packages in the same order as enum sectors.

## Enums

```ts
const color = DefineEnum("color", ["red", "green", "blue", null]);
const packet = CreateEnumPacket({ tag: "color", enumData: color });
await socket.send("color", WrapEnum("color", "green"));
```

Enum values are type-sensitive, and `NaN` matches `NaN`. Enum packages are registered by tag; defining the same tag inconsistently is an error. On the wire each value is its byte index, so an enum has at most 255 entries.

## JSON

JSONUtil is richer than JSON text: it preserves compact typed primitives and nested arrays/objects. The Rust core intentionally treats wire type 16 as opaque bytes. TypeScript performs JSON conversion before/after Rust framing. Do not pass untrusted structures with excessive depth; decompression is bounded, but application-level nesting still deserves limits.

## Helpers

`FlattenData(rows)` transposes rows into columns; `UnFlattenData(columns)` reverses it. These are useful manually and are automatically applied by object packets with `autoFlatten: true`.
