# TypeScript runtime and deployment

## Rust core loading

Node synchronously loads the packaged Node-target WASM module. Browsers load the bundler-target WASM module during `SonicWS.initialize()`. SonicWS does not ship or discover platform-specific Node addons.

`initializeWasmCore()` explicitly loads the WASM implementation. The stable wrapper handles signed/unsigned numbers, floats, strings, booleans, raw decode, hex, object framing, batching, compression, and encoded validation.

In browsers, initialization validates the local `bundle.wasm` magic bytes. When the local file is unavailable or invalid, the loader uses jsDelivr only after the CDN release protocol version matches the local TypeScript protocol exactly. It throws instead of loading an unverifiable or incompatible core.

## Compression safety

The Rust core bounds raw-DEFLATE expansion. Schema-aware paths derive tighter limits where possible; direct inflate helpers require/use a conservative ceiling. Never replace bounded inflate with `read_to_end` or an unbounded JavaScript inflater on network input.

## Build outputs

- TypeScript package: `projects/ts`
- TypeScript sources: `projects/ts/src`
- compiled Node modules: `projects/ts/dist`
- Rust crate: `projects/core`
- browser outputs: `bundled/bundle.js`, `bundled/bundle.wasm`
- generated WASM bindings: `projects/ts/src/native/wasm`

Run the package scripts from `projects/ts`. Generated outputs should be rebuilt whenever Rust FFI signatures change. `npm pack` stages the canonical root README, license, and browser bundle without maintaining duplicate tracked copies.
