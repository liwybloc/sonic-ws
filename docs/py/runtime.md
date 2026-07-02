# Python native core and deployment

## Binding model

`sonic_ws._core` loads a platform shared library with `ctypes`. It searches `SONIC_WS_CORE_PATH`, the package `_native` library, and local Rust build outputs. The ABI uses owned byte buffers plus explicit free calls; Python copies results before Rust frees them.

The binding exposes signed/unsigned number, float, string, boolean, raw decode, hex, object framing, batch, raw-DEFLATE, and encoded validation operations. RAW encode intentionally remains a Python `bytes(value)` operation because bytes → bytes has no codec work.

## Building and wheels

`src/py/setup.py` runs:

```text
cargo build --release --features python --manifest-path src/core/Cargo.toml
```

It then bundles `_native.so`, `_native.dylib`, or `_native.dll`, plus the JavaScript/WASM browser client served by the Python server. Native libraries are platform- and architecture-specific. Publish separate wheels for Linux architectures/libc targets, macOS architectures, and Windows architectures. Python itself does not execute the browser WASM binding.

Set `SONIC_WS_CORE_PATH=/absolute/path/to/library` to test a particular build.

## Compatibility contract

TypeScript and Python use protocol version 22, the same schema serializer, one-based packet keys, raw DEFLATE, object sector frames, batch frames, enum ordering, and JSONUtil binary representation. `src/ts/tests/test_compat.mjs` and `src/py/tests/test_compat.py` exercise every supported packet mode in both server/client directions.

## Security boundaries

Rust decompression rejects output beyond configured/global limits. Batch count and schema ranges are checked before listeners. Those protections do not replace WebSocket message-size limits, authentication, connection limits, application timeouts, or limits on user-level JSON/object complexity.
