# sonic-ws

### The socket library that handle correctness, security, and performance for you

SonicWS is a schema-driven WebSocket library for multiple languages. It uses a shared Rust packet codec, to provide compact binary packets, validation before listener execution, batching, compression, built-in rate limiting, and more.

It is designed for real-time applications such as games, dashboards, collaborative tools, and distributed systems where packet correctness, bandwidth efficiency, and predictable socket lifecycle behavior matter.

## Why SonicWS?

- Define exactly which packets each side may send.
- Reject invalid packets before user callbacks run.
- Use compact numeric packet IDs instead of repeated string keys.
- Share the same packet codec across Node and browser clients.
- Batch, validate, compress, and rate-limit packets with minimal boilerplate.
- Reconnect with bounded state recovery and opt-in missed-packet replay.
- Use validated RPC, server-side rooms, and pluggable scaling adapters.
- Inspect, encode, decode, size, validate, and generate types from packet manifests with the CLI.
- Drop replaceable updates under backpressure without silently dropping reliable messages.
- Code is much more readable than every other socket library*

<details>
<summary>DETAILED INFO</summary>

SonicWS is an ultra-lightweight, high-performance WebSocket library focused on maximum bandwidth efficiency, speed, and security.

The packet codec is written in Rust and shared by every runtime. Node and browsers use the core compiled to WebAssembly. This keeps packet encoding, decoding, validation, batching, and compression consistent between the server and client without platform-specific Node binaries.

Compression:
- Lossless compression up to 70% or more (for example, 38kb -> 14kb)
- Optimized bandwidth for many different types to fit special constraints
- Automatic helpers to flatten typed nested arrays for maximum wire efficiency (for example, [[1,false,"text"],[4,true,"other"]] to [[1,4],[false,true],["text","other"]])
- Uses raw binary bytes to transmit data as efficiently as possible while still using high level readable code
- Built-in ability to use compression libraries

Developer Friendly:
- Predefined data types of various sized integers, single and double precision floating point numbers, strings, enums, etc. and RAW to allow for developers to do anything they want
- Keys are automatically indexed before transfer, improving readability and efficiency (for example, send("pixel") and send("p") use the same bandwidth)
- Data is validated and supports custom validation, ensuring only valid, safe, and untampered packets ever call your listeners
- Edge cases are heavily tested across large data ranges; strings support code points up to the max of 0x10FFFF
- Debug tools to view all packets

Security:
- Tamper-proof; any invalid packet instantly causes closure, and tampering becomes incredibly difficult
- Basic but immensely effective anti-tampering for browser clients
- Built-in ability for handshake packets, preventing repetitive initiation checks in listeners (for example, removes if(!init) everywhere)
- Built-in rate limiting for packets; ability for global send & receive, alongside per-packet rate limiting
- Built-in disabling & enabling of packets to prevent abuse
- Prevents any race conditions; your callbacks will not be called until the last one finishes. (Alongside async options!)
- Prevents niche bugs found in other websocket libraries, such as functions calling after the socket already closed.

Performance & Scaling:
- Can parse very large packets in microseconds
- Can support megabytes of data and millions of values with minimal latency
- Can broadcast to a filtered list of connections such as all, except sender, or any other subset
- Built-in packet batching feature with no boilerplate and with per-client queues and bandwidth efficiency

Developer Experience:
- Minimal boilerplate code due to listeners only receiving valid data
- Enums can map to any primitive value (e.g. number, string, boolean, null) and transmits in 1 byte
- Timers and intervals for sockets that automatically clear upon closure
- Many data types to maximize speed, clarity, bandwidth, and security
- Debug tools for socket ids, byte size, data logging, etc. for troubleshooting
- Very minimal learning curve, easy to work in
- JSDoc for understanding; immensely intuitive (personally, I took a break for half a year and came back and snapped right back in)
- Almost every case has a pre-made wire optimization and boilerplate removal.

Whether you're making a real-time game, a dashboard, a distributed system, or anything else, SonicWS gets you safe, structured packets; fast.

\* = More readable than code I've seen written for socket.io and other libraries
</details>

## HOW IT WORKS

You define the packets each side is allowed to send. SonicWS exchanges that schema during the connection handshake, assigns compact numeric packet IDs, and validates incoming data before calling your listeners.

The TypeScript, Python, and native Rust packages handle connections, packet definitions, and their language-specific public APIs. The shared Rust core handles the wire format:

- Primitive and object packet encoding/decoding
- Packet validation and range checks
- Enum, string, boolean, varint, delta, float, and hex codecs
- Object framing, batching, and raw DEFLATE compression
- TypeScript/Python-side JSON conversion transported through reserved wire type 16 as raw bytes

Node and browsers run the core through WebAssembly, and Python loads its packaged WASM core through `wasmtime`. The native Rust package links the core directly and adds a Tokio WebSocket client/server runtime. Protocol behavior therefore comes from the same codec on every supported runtime.

Automatic browser-file serving at `/SonicWS/bundle.js` and
`/SonicWS/bundle.wasm` is supported only by the Node.js server, where it can be
installed directly on the native HTTP server. If the SonicWS server is written
in Python or another language, serve the browser files yourself or use the CDN
bundle:

```html
<script src="https://cdn.jsdelivr.net/gh/liwybloc/sonic-ws/release/SonicWS_bundle"></script>
```

The browser loader prefers the server's local `bundle.wasm`. If it isn't
available, it verifies that jsDelivr's release protocol matches the client and
then loads the CDN WASM module. Initialization fails on a version mismatch or
invalid download.

## INSTALLATION

NodeJS/Typescript:
```sh
npm install sonic-ws
```
Python* (*unpublished currently):
```sh
pip install sonic-ws
```
Rust:
```toml
sonic-ws = { path = "projects/rust" }
```

## BUILDING AND TESTING

Building requires Node.js, Rust with the `wasm32-unknown-unknown` target, and `wasm-pack`.

From the repository root, use the build dispatcher:

```sh
./build.sh all       # Build every project
./build.sh rust      # Shared core and native Rust runtime
./build.sh core      # Shared codec core only
./build.sh ts        # Complete Node/browser package
./build.sh py        # Python wheel and sdist
./build.sh test      # Run all test suites
./build.sh help      # List every target
```

The underlying TypeScript commands can also be run directly:

```sh
cd projects/ts
npm install
npm run build       # TypeScript, Node WASM, browser WASM, and browser bundle
npm run build_node  # Node distribution and Node-target WASM
npm run build_web   # Browser bundle and WASM
npm run test_node   # Node end-to-end packet tests
npm run test_web    # Headless browser/WASM end-to-end tests
```

The workspace is split into `projects/core`, `projects/rust`, `projects/ts`, and `projects/py`.
Each project owns its source, tests, and packaging configuration. Shared browser
artifacts remain at `bundled/bundle.js` and `bundled/bundle.wasm`.

Build or install the Python project separately:

```sh
python -m pip install ./projects/py
```

Full API documentation:

- [TypeScript / Node / browser](docs/ts/README.md)
- [Python](docs/py/README.md)
- [Native Rust](projects/rust/README.md)
- [Protocol version 25](docs/protocol.md)
- [Production defaults](docs/defaults.md)
- [Authentication and recovery](docs/authentication.md)
- [Inspector, generated types, conformance, and benchmarks](docs/tooling.md)
- [Backpressure and delivery](docs/backpressure.md)
- [Runnable examples](examples/README.md)

Cross-language compatibility peers can be selected from the root build script. Run one host and one client in separate terminals:

```sh
./build.sh test_compat typescript --host
./build.sh test_compat python --client

# Rust can be either side too
./build.sh test_compat rust --client
```

Packet schemas can now map the existing single-type wire format directly to application objects:

```js
const entitySnapshot = CreatePacket({
  tag: "entitySnapshot",
  type: PacketType.VARINT,
  schema: ["id", "type", "x", "y", "z", "pitch", "yaw"],
  autoFlatten: true,
});

await ws.send("entitySnapshot", [...entities.values()]);
```

This remains a homogeneous `VARINT` packet. Schema mapping, row-major `autoFlatten`, object-packet `autoTranspose`, quantization, bounds, and packet groups are application-layer conveniences and do not turn the codec into a mixed-type serializer. See the packet documentation above for TypeScript and Python examples.

Clients can opt into capped exponential-backoff reconnect. Packets marked `replay: true` are retained in a bounded per-session buffer; successful recovery also restores server-side `state` and room membership. RPC request payloads use ordinary packet definitions, so validation and compact encoding still apply. Room broadcasts work locally and can be forwarded across processes through an adapter. Long-polling fallback is intentionally outside SonicWS's scope.

## WHERE SONICWS FITS

SonicWS is strongest for schema-known realtime traffic: numeric movement updates, repeated entity snapshots, compact enums, bounded RPC payloads, and other messages where validation and wire size matter. Positional sends are available as the lowest-allocation hot path, while schema mapping trades some CPU for cleaner application objects.

Arbitrary chat strings and already-compressed or highly dynamic JSON may see little or no size improvement over ordinary JSON WebSockets. SonicWS should be selected for its explicit packet contract, validation, lifecycle behavior, and compact structured traffic—not because every possible payload encodes faster or smaller than JSON.

## KNOWN ISSUES


## PLANNED FEATURES
- Better encoding for the first packet that sends packet information
- Publish the Rust core as a standalone, documented crate
- Add first-class Go bindings

## API AND PROTOCOL STABILITY

SonicWS uses semantic package versions and an explicit wire-protocol version. Incompatible wire changes require a protocol-version change and fail during handshake instead of silently decoding with different semantics. Public APIs may still evolve between major package versions; pin the package version for production deployments and run the shared conformance corpus when upgrading.

## LICENSE
This project is source-available.

You are free to use, modify, and contribute for personal,
non-commercial purposes.

Commercial use requires a separate license. Please contact me regarding information on this.
