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
- Code is much more readable than every other socket library*

<details>
<summary>DETAILED INFO</summary>

SonicWS is an ultra-lightweight, high-performance WebSocket library focused on maximum bandwidth efficiency, speed, and security.

The packet codec is written in Rust and shared by every runtime. Node can use the native N-API addon (with a WASM fallback), while browsers use the same core compiled to WebAssembly. This keeps packet encoding, decoding, validation, batching, and compression consistent between the server and client.

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
- Can handle very large packets in microseconds
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

The TypeScript/python layer handles connections, packet definitions, middleware, and the public API. The Rust core handles the wire format:

- Primitive and object packet encoding/decoding
- Packet validation and range checks
- Enum, string, boolean, varint, delta, float, and hex codecs
- Object framing, batching, and raw DEFLATE compression
- TypeScript/Python-side JSON conversion transported through reserved wire type 16 as raw bytes

The same Rust implementation is exposed through N-API for native Node use and through WASM for browsers and the portable Node fallback. Protocol behavior therefore does not depend on which runtime is connected.

## INSTALLATION

NodeJS/Typescript:
```sh
npm install sonic-ws
```
Python*: (*unpublished currently)
```
pip install sonic-ws
```

## BUILDING AND TESTING

Building requires Node.js, Rust with the `wasm32-unknown-unknown` target, and `wasm-pack`.

```sh
npm run build       # TypeScript, Node WASM, browser WASM, and browser bundle
npm run build_py    # Pip installs the python project
npm run build_node  # Node distribution and WASM fallback
npm run build_web   # Browser bundle and WASM
npm run test_node   # Node end-to-end packet tests
npm run test_web    # Headless browser/WASM end-to-end tests
```

The Rust crate lives in `src/core`, and the TypeScript API lives in `src/ts`. Generated JavaScript is written to `dist/ts`; browser artifacts are written to `bundled/bundle.js` and `bundled/bundle.wasm`.

The Python package lives in `src/py`. It provides asyncio clients and servers
using the same protocol and builds a platform-specific Rust codec library into
its wheel:

Full API documentation:

- [TypeScript / Node / browser](docs/ts/README.md)
- [Python](docs/py/README.md)

## KNOWN ISSUES

- `KEY_EFFECTIVE` is reserved but still a work in progress.
- Native `.node` addons are platform-specific. WASM is used as the portable fallback, while prebuilt native binaries will need separate builds for each supported operating system and architecture.

## PLANNED FEATURES
- Better encoding for the first packet that sends packet information
- Publish the Rust core as a standalone, documented crate
- Add first-class Go bindings
- Provide prebuilt N-API binaries for the main Node platforms to avoid using WASM for the server

## LICENSE
This project is source-available.

You are free to use, modify, and contribute for personal,
non-commercial purposes.

Commercial use requires a separate license. Please contact me regarding information on this.
