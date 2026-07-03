# Python WASM core and deployment

## Binding model

`sonic_ws._core` loads the packaged `_core.wasm` module through `wasmtime`. It can also load a development module selected by `SONIC_WS_CORE_PATH` or the sibling Rust target directory. The binding uses an explicit linear-memory allocation/copy/free ABI and does not depend on browser `wasm-bindgen` JavaScript glue.

The binding exposes signed/unsigned number, float, string, boolean, raw decode, hex, object framing, batch, raw-DEFLATE, and encoded validation operations. RAW encode intentionally remains a Python `bytes(value)` operation because bytes → bytes has no codec work.

## Building and wheels

`projects/py/setup.py` runs:

```text
cargo build --release --features python --target wasm32-unknown-unknown --target-dir projects/core/target/python-wasm --manifest-path projects/core/Cargo.toml
```

with the `wasm32-unknown-unknown` target and bundles the resulting module as `sonic_ws/_core.wasm`. The resulting wheel is `py3-none-any`; one wheel works across supported Python operating systems and architectures. `wasmtime` remains a normal dependency and supplies its own maintained runtime wheel for the current platform. Python wheels do not include or serve the browser JavaScript/WASM bundle.

Set `SONIC_WS_CORE_PATH=/absolute/path/to/sonic_ws_core.wasm` to test a particular build. Building from source requires Rust and the `wasm32-unknown-unknown` target; installing the published wheel does not.

## Compatibility contract

TypeScript and Python use protocol version 23, the same schema serializer, one-based packet keys, raw DEFLATE, object sector frames, batch frames, enum ordering, and JSONUtil binary representation. `projects/ts/tests/test_compat.mjs` and `projects/py/tests/test_compat.py` exercise every supported packet mode in both server/client directions.

The Python project uses the standard `src/` package layout. Wheel builds compile the sibling Rust project to portable WASM. Source-distribution builds temporarily stage the Rust workspace input so the published sdist can build independently.

## Security boundaries

Rust decompression rejects output beyond configured/global limits. Batch count and schema ranges are checked before listeners. Those protections do not replace WebSocket message-size limits, authentication, connection limits, application timeouts, or limits on user-level JSON/object complexity.
