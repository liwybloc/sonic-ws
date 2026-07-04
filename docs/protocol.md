# SonicWS protocol version 24

All integers described as varints use unsigned base-128 little-endian groups. Packet keys are one byte. Key `0` is reserved for control frames; user packet tables are indexed from `1` through `254`.

## Server handshake

The first server message is:

```text
"SWS" | VERSION_U8 | RAW_DEFLATE(PAYLOAD)
```

The expanded payload is:

```text
CONNECTION_ID_VARINT
SESSION_ID_LENGTH_VARINT | SESSION_ID_UTF8
CLIENT_PACKET_TABLE_LENGTH_VARINT | CLIENT_PACKET_TABLE
SERVER_PACKET_TABLE
```

A client must reject a magic or version mismatch. Expanded DEFLATE output is bounded by the codec.

## Normal messages

```text
PACKET_KEY_U8 | PACKET_PAYLOAD
```

The packet table determines the payload codec and validation limits. Invalid, disabled, malformed, or rate-limited client packets are closed before application listeners execute.

## Control messages

```text
0x00 | CONTROL_TYPE_U8 | CONTROL_PAYLOAD
```

| Type | Name | Payload |
|---:|---|---|
| 1 | request | request ID varint, packet key, ordinary encoded packet payload |
| 2 | response | request ID varint, success byte, JSONUtil value |
| 3 | replay | sequence varint, complete ordinary packet frame |
| 4 | resume | session-ID length varint, session ID, last sequence varint |
| 5 | resumed | success byte, replayed-frame count varint |

Unknown or malformed control frames close with `INVALID_DATA`.

## Packet schema records

Each packet record contains its Latin-1 tag, packed flags, a length-prefixed UTF-8 JSON metadata object, batching interval, enum packages, value-count limits, and packet type IDs. Object packets contain one type and range per sector. Metadata currently carries field schema, quantization, logical min/max, group metadata, local constructor name, and replay eligibility.

Packet manifests prepend `SWSM`, protocol version, and the client-table byte length to the same two serialized packet tables.

## Primitive payloads

- `NONE`: empty.
- `RAW` / reserved type 16: opaque bytes.
- `BYTES`, `SHORTS`: signed values zigzag encoded into fixed-width unsigned storage.
- `UBYTES`, `USHORTS`: fixed-width unsigned values.
- `VARINT`: i32-compatible zigzag values encoded as unsigned varints.
- `UVARINT`: unsigned varints.
- `DELTAS`: first value relative to zero, then signed zigzag deltas.
- `FLOATS`, `DOUBLES`: IEEE-754 big-endian.
- `BOOLEANS`: MSB-first bit packing; the schema supplies the logical count.
- `STRINGS_ASCII`: count/length header plus the fixed SonicWS Huffman table.
- `STRINGS_UTF16`: Unicode scalar values encoded as varints; the historical name is retained.
- `ENUMS`: one-byte indices into the exchanged enum package.
- `HEX`: opaque decoded hexadecimal bytes.

Type 15 is unassigned. Type 16 is reserved for application-level conversion; TypeScript and Python use JSONUtil before handing those bytes to the Rust RAW path.

## Object packets

Each sector is framed as:

```text
SECTOR_LENGTH_VARINT | SECTOR_PAYLOAD
```

Sector count and order come from the object schema. Missing, extra, truncated, or invalid sectors are rejected.

## Batch packets

The packet key appears once, followed by repeated:

```text
ITEM_LENGTH_VARINT | ITEM_PAYLOAD
```

When compression is enabled, the complete batch body is raw-DEFLATE compressed. Expanded size and item count are bounded.

## Quantization

Quantization is a language-layer transform before primitive encoding:

```text
wire = round(logical * scale + residual)
logical = wire / scale
residual = adjusted - wire
```

Residual tracking is per packet and connection. It changes future rounded values but never changes the primitive wire format.

## Recovery

Replayable server frames receive monotonically increasing sequence numbers and are retained within configured count/time limits. On reconnect, possession of the session ID is necessary but may not be sufficient: servers can authorize recovery against the newly authenticated state. By default, an existing `state.userId` must equal the replacement connection's `state.userId`.

Only idempotent state updates should be replayable. Inputs, payments, destructive commands, and other non-idempotent actions should not use replay.

## Close codes

| Code | Meaning |
|---:|---|
| 4000 | rate limit |
| 4001 | empty/undersized frame |
| 4002 | invalid packet key |
| 4003 | invalid packet payload |
| 4004 | invalid data/control/handshake timeout |
| 4005 | repeated application handshake |
| 4006 | disabled packet |
| 4007 | middleware rejection |
| 4008 | server shutdown |
| 4009 | outbound backpressure limit |

## Conformance

[`protocol/golden-vectors.json`](../protocol/golden-vectors.json) is the normative executable corpus for stable primitive and high-level mapping examples. Rust, Node/WASM, and Python tests consume the same file.
