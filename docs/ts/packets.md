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
- `replay`: retain this server-to-client packet in the bounded session buffer for connection recovery. Use only for idempotent updates; it cannot be combined with `dataBatching`.
- `rateLimit`: per-second limit stored in the 0…65,535 range; zero or a larger value means unlimited.
- `enabled`: whether clients may send this packet initially.
- `validator(socket, ...values)`: server-side application validation. Return false to reject the packet.

`CreatePacketManifest({ clientPackets, serverPackets })` serializes both packet tables into a protocol-versioned binary artifact. `LoadPacketManifest(bytes)` loads an artifact produced by TypeScript or Python. Validators and local constructors remain application code and must be registered in each runtime.

## Typed packet arrays and browser client types

Use `DefinePackets` when you store packet definitions before passing them to a server. It preserves literal tags and schema fields for TypeScript inference:

```ts
const clientPackets = DefinePackets([
  CreatePacket({
    tag: "movement.move",
    type: PacketType.VARINT,
    schema: ["dx", "dy", "dz"],
    dataMax: 3,
  }),
] as const);

const serverPackets = DefinePackets([
  CreatePacket({
    tag: "entity.remove",
    type: PacketType.VARINT,
    schema: ["id"],
    dataMax: 1,
  }),
] as const);

const wss = new SonicWSServer({ clientPackets, serverPackets });

wss.on_connect(socket => {
  socket.on("movement.move", packet => {
    packet.dx;
    packet.dy;
    packet.dz;
  });

  socket.send("entity.remove", { id: 7 });
});
```

The browser client cannot infer packet types from the runtime handshake or from a binary manifest. TypeScript and JSDoc run before the socket connects. Generate a type file beside the binary manifest instead:

```ts
await wss.serializePackets({
  path: "./public/serialized.bin",
  typesPath: "./public/serialized.d.ts",
});
```

Then use the generated type in browser TypeScript:

```ts
import type { SonicWSPacketTypes } from "./serialized";

const ws = await SonicWS.connect<SonicWSPacketTypes>(`ws://${location.host}`);

ws.on("entity.remove", packet => {
  packet.id;
});
```

Or in browser JavaScript with JSDoc:

```js
/** @typedef {import("./serialized").SonicWSPacketTypes} SonicWSPacketTypes */

/** @type {import("sonic-ws").SonicWS<SonicWSPacketTypes>} */
const ws = await SonicWS.connect(`ws://${location.host}`);

ws.on("entity.remove", packet => {
  console.log(packet.id);
});
```

`serialized.bin` is still useful for tools and non-TypeScript consumers. `serialized.d.ts` is the compile-time type source.

## Schemas, repeated records, and quantization

`schema` maps positional payloads to objects without changing their wire bytes:

```ts
const movement = CreatePacket({
  tag: "movementMove",
  type: PacketType.SHORTS,
  schema: ["dx", "dy", "dz"],
  dataMin: 3,
  dataMax: 3,
  quantized: { scale: 32767, trackError: true },
  min: -1,
  max: 1,
});
await socket.send("movementMove", { dx: .5, dy: 0, dz: -.5 });
```

All fields are required and extra fields are rejected. Positional sends remain supported and produce identical bytes. `min` and `max` are inclusive application-level bounds. Quantization rounds `value * scale` before encoding and divides after decoding; the integer codec still enforces its native range. `trackError` defaults to true and feeds each rounding residual into the next value encoded by that packet and connection. Set it to false for independent stateless rounding.

Homogeneous `autoFlatten: true` accepts one array of fixed-width records and encodes them row-major. The decoded value count must be divisible by `schema.length`:

```ts
const snapshots = CreatePacket({
  tag: "entitySnapshot",
  type: PacketType.VARINT,
  schema: ["id", "type", "x", "y", "z", "pitch", "yaw"],
  autoFlatten: true,
});
await socket.send("entitySnapshot", [...entities.values()]);
```

Variable-width records are not implemented; use another packet or explicit object sectors.

### Constructed schema values

Pass `constructor: Class` to instantiate decoded schema objects:

```ts
class C2SMovement {
  x: number; y: number; z: number;
  constructor({ x, y, z }: { x: number; y: number; z: number }) {
    this.x = x; this.y = y; this.z = z;
  }
}

const movement = CreatePacket({
  tag: "movement",
  type: PacketType.VARINT,
  schema: ["x", "y", "z"],
  dataMax: 3,
  constructor: C2SMovement,
});
```

Only `"C2SMovement"` is exchanged in schema metadata; executable code is never transmitted or evaluated. Creating the packet registers the class locally. On a peer that does not create the same definition, call `RegisterPacketConstructor(C2SMovement)` before the first value is decoded. Class names must therefore remain stable when bundling/minifying. The same behavior applies to every record produced by `autoFlatten` and `autoTranspose`.

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

`dataMins` and `dataMaxes` accept either one number for every sector or one number per type. With `schema`, `autoTranspose: true` accepts repeated objects and transposes them into column-major sectors, then reconstructs objects on receive. Object `autoFlatten` remains a deprecated alias. Object enums consume enum packages in the same order as enum sectors.

## Packet groups

`CreatePacketGroup` returns normal child packets to spread into a packet list:

```ts
const movement = CreatePacketGroup({
  tag: "movement",
  variants: {
    still: { type: PacketType.NONE },
    move: { type: PacketType.VARINT, schema: ["dx", "dy", "dz"], dataMax: 3 },
  },
});
const wss = new SonicWSServer({ clientPackets: [...movement] });
await socket.sendVariant("movement", "move", { dx: 1, dy: 2, dz: 3 });
socket.on("movement.move", payload => {});
socket.on("movement", event => console.log(event.variant, event.payload));
```

The helper creates one `NONE` parent plus one normal dot-qualified packet per variant. For example, `movement` with `still` and `move` variants creates `movement`, `movement.still`, and `movement.move`. Receiving a child fires both its child-specific listener and the parent listener. Sending the parent directly represents the empty variant (`variant: ""`).

Use `defaults` when variants share settings. A string array is accepted only when `defaults` is present:

```ts
CreatePacketGroup({
  tag: "movement",
  variants: ["W", "A", "S", "D"],
  defaults: { type: PacketType.SHORTS },
});

CreatePacketGroup({
  tag: "movement",
  variants: { W: {}, A: { type: PacketType.SHORTS } },
  defaults: { type: PacketType.USHORTS },
});
```

Defaults are applied first, so each object variant can override them. `delegate` is accepted as a deprecated alias for `defaults`; do not provide both.

`VariantPermutation` generates combination variants and negotiates its boolean keys with every peer:

```ts
const movement = CreatePacketGroup({
  tag: "movement",
  variants: VariantPermutation.WASD(),
  defaults: { type: PacketType.SHORTS, dataMin: 1, dataMax: 1 },
});

await socket.sendPermutation(
  "movement",
  { W: true, A: true, S: false, D: false },
  5,
);
```

Boolean arrays use the declared key order. The call above selects `movement.W,A`. Invalid opposite combinations such as W+S are rejected. A parent listener receives `{ variant: "W,A", payload, permutation: { W: true, A: true, S: false, D: false } }`. `broadcastPermutation` provides the equivalent server-wide helper.

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

`FlattenData(rows)` transposes rows into columns; `UnFlattenData(columns)` reverses it. Prefer homogeneous `autoFlatten` for row-major records and object `autoTranspose` for column-major records.
