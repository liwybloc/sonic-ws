# Tooling

## Inspector CLI

The npm package installs `sonicws`:

```sh
sonicws inspect packets.swsm
sonicws validate packets.swsm
sonicws encode packets.swsm client movement.move '{"dx":1,"dy":0,"dz":2}'
sonicws decode packets.swsm server entity.remove 02
sonicws size packets.swsm client movement.move '{"dx":1,"dy":0,"dz":2}'
sonicws types packets.swsm generated-packets.d.ts
```

The CLI consumes the binary packet manifest created by `CreatePacketManifest` / `create_packet_manifest`. It never evaluates source code from a manifest. Generated types cover packet tags, schema-shaped objects, repeated rows, primitive payloads, and packet-group parent variants. Local constructors and validators remain application code.

## Schema validation

`ValidatePacketSchema` returns `{ errors, warnings }`; `AssertPacketSchema` throws on errors. Packet holders call the assertion automatically. Whole-table validation catches duplicate tags, missing group parents, duplicate variants, packet-count overflow, replay/batching conflicts, unsigned negative bounds, and invalid quantization. Optional client-direction warnings identify effectively unbounded public packets.

## Readable packet logs

```ts
connection.addMiddleware(new PacketLogger());
```

```py
connection.add_middleware(PacketLogger())
```

Logs contain direction, tag, decoded values, frame size, and timestamp. Pass a custom logger and `includeValues: false` / `include_values=False` when packet values may contain secrets.

## Golden corpus and fuzzing

Run `./build.sh conformance` to execute the shared golden vectors in Node/WASM and Python; `cargo test` consumes the same primitive vectors in Rust. Rust libFuzzer targets exercise every primitive decoder/validator and object-sector framing.

Run `./build.sh benchmark` for reproducible local size and codec-performance results.
