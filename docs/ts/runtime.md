# TypeScript runtime and deployment

## Rust core loading

Node first checks an explicit addon path, `SONIC_WS_CORE_PATH`, and packaged native-addon candidates. If none load, it requires the packaged Node WASM module. Native `.node` files are specific to operating system, CPU architecture, Node ABI/N-API support, and libc environment; build and publish separate artifacts. WASM is portable and is the default browser route.

`initializeWasmCore()` explicitly loads the WASM implementation. The stable wrapper handles signed/unsigned numbers, floats, strings, booleans, raw decode, hex, object framing, batching, compression, and encoded validation.

## Compression safety

The Rust core bounds raw-DEFLATE expansion. Schema-aware paths derive tighter limits where possible; direct inflate helpers require/use a conservative ceiling. Never replace bounded inflate with `read_to_end` or an unbounded JavaScript inflater on network input.

## Build outputs

- TypeScript sources: `src/ts`
- compiled Node modules: `dist/ts`
- Rust crate: `src/core`
- browser outputs: `bundled/bundle.js`, `bundled/bundle.wasm`
- generated WASM bindings: `src/ts/native/wasm`

Use the package scripts in `package.json` to build Node and browser targets. Generated outputs should be rebuilt whenever Rust FFI signatures change.
