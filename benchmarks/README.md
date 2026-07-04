# Benchmarks

Build the Node package, then run:

```sh
./build.sh benchmark
```

Set `SONIC_BENCH_ITERATIONS` to control duration. For memory comparisons, run Node with `--expose-gc`.

The committed harness measures exact SonicWS application-frame bytes, raw WebSocket/uWebSockets.js JSON payload bytes, Socket.IO EVENT packet bytes, ten-message batch size, encode throughput, latency percentiles, CPU time, and heap delta. Socket.IO size is calculated from its actual event representation, `42["event",value]`, so the event name and `42` protocol prefix are counted on top of the JSON value. uWebSockets.js deliberately defines no application packet format, so its size and serialization baseline is the same JSON payload used by raw WebSocket. WebSocket framing and TLS overhead are excluded. Compression is intentionally excluded from the primary size table.

- schema mapping and quantization (`prepareSend`)
- positional preparation versus object preparation
- codec-only work
- Rust/WASM VARINT reference encoding
- complete SonicWS encoding
- frame allocation and payload copying
- `JSON.stringify` alone and with UTF-8 byte measurement
- Socket.IO EVENT serialization and UTF-8 byte measurement
- batch framing alone and ten encode-plus-frame operations
- no-op and empty-allocation harness baselines

Results are written to `benchmarks/results/` and are intentionally machine-specific. Use `node --expose-gc benchmarks/run.mjs` when comparing heap deltas.

VARINT, UVARINT, and uncompressed batch framing have parity-tested JavaScript hot paths. Rust/WASM remains the reference implementation and handles decoding, validation, compression, strings, objects, and the other packet modes. The benchmark reports the WASM reference beside the hot path so a regression is visible rather than hidden behind an aggregate number.

`transport.mjs` compares sequential localhost round trips for raw `ws` with JSON, the official Socket.IO server and client forced to WebSocket transport, uWebSockets.js with JSON, and SonicWS validated binary packets. Compression is disabled. Each result reports request application bytes and p50/p95/p99 latency. A missing package, unsupported native ABI, or startup failure is recorded as a skipped benchmark with its actual error; it is never represented as a measurement.

Install isolated competitors and run the transport suite with:

```sh
cd benchmarks
npm install
cd ..
SONIC_TRANSPORT_ITERATIONS=2000 node benchmarks/transport.mjs
```

The harness does not invent Socket.IO or uWebSockets.js results. End-to-end comparisons must pin library versions, use equivalent validation/compression settings, include WebSocket framing, and publish the benchmark machine and command.
