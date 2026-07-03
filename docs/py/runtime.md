# Python native core and deployment

## Binding model

`sonic_ws._core` loads a platform shared library with `ctypes`. It searches `SONIC_WS_CORE_PATH`, the package `_native` library, and local Rust build outputs. The ABI uses owned byte buffers plus explicit free calls; Python copies results before Rust frees them.

The binding exposes signed/unsigned number, float, string, boolean, raw decode, hex, object framing, batch, raw-DEFLATE, and encoded validation operations. RAW encode intentionally remains a Python `bytes(value)` operation because bytes → bytes has no codec work.

## Building and wheels

`projects/py/setup.py` runs:

```text
cargo build --release --features python --manifest-path projects/core/Cargo.toml
```

It then bundles `_native.so`, `_native.dylib`, or `_native.dll`. Native libraries are platform- and architecture-specific. Publish separate wheels for Linux architectures/libc targets, macOS architectures, and Windows architectures. Python wheels do not include or serve the browser JavaScript/WASM bundle.

Set `SONIC_WS_CORE_PATH=/absolute/path/to/library` to test a particular build.

## Compatibility contract

TypeScript and Python use protocol version 22, the same schema serializer, one-based packet keys, raw DEFLATE, object sector frames, batch frames, enum ordering, and JSONUtil binary representation. `projects/ts/tests/test_compat.mjs` and `projects/py/tests/test_compat.py` exercise every supported packet mode in both server/client directions.

The Python project uses the standard `src/` package layout. Wheel builds compile the sibling Rust project. Source-distribution builds temporarily stage the Rust workspace input so the published sdist can build independently.

## Security boundaries

Rust decompression rejects output beyond configured/global limits. Batch count and schema ranges are checked before listeners. Those protections do not replace WebSocket message-size limits, authentication, connection limits, application timeouts, or limits on user-level JSON/object complexity.
