# Benchmarks

Build the Node package, then run:

```sh
./build.sh benchmark
```

Set `SONIC_BENCH_ITERATIONS` to control duration. For memory comparisons, run Node with `--expose-gc`.

The committed harness measures exact application-frame bytes, raw-DEFLATE size, ten-message batch size, encode throughput, latency percentiles, CPU time, and heap delta. It separates:

- schema mapping and quantization (`prepareSend`)
- positional preparation versus object preparation
- codec-only work
- Rust/WASM VARINT reference encoding
- complete SonicWS encoding
- frame allocation and payload copying
- `JSON.stringify` alone and with UTF-8 byte measurement
- batch framing alone and ten encode-plus-frame operations
- no-op and empty-allocation harness baselines

Results are written to `benchmarks/results/` and are intentionally machine-specific. Use `node --expose-gc benchmarks/run.mjs` when comparing heap deltas.

VARINT, UVARINT, and uncompressed batch framing have parity-tested JavaScript hot paths. Rust/WASM remains the reference implementation and handles decoding, validation, compression, strings, objects, and the other packet modes. The benchmark reports the WASM reference beside the hot path so a regression is visible rather than hidden behind an aggregate number.

`transport.mjs` additionally compares sequential localhost round trips for raw `ws` with JSON and SonicWS validated binary packets. Socket.IO and uWebSockets.js are explicitly reported as skipped until their packages/adapters are installed; the suite never labels missing measurements as results.

The harness does not invent Socket.IO or uWebSockets.js results. End-to-end comparisons must pin library versions, use equivalent validation/compression settings, include WebSocket framing, and publish the benchmark machine and command.
