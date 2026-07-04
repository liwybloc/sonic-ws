# SonicWS TypeScript documentation

The TypeScript package is the primary Node and browser API for SonicWS. It exchanges packet schemas during the WebSocket handshake and delegates binary encoding, decoding, validation, batching, and raw DEFLATE to the Rust WebAssembly core in both environments.

## Contents

- [Getting started](getting-started.md)
- [Packet schemas and every packet type](packets.md)
- [Client API](client.md)
- [Server and connection API](server.md)
- [Middleware](middleware.md)
- [Native core, browser bundle, and deployment](runtime.md)
- [Protocol specification](../protocol.md)
- [Production defaults](../defaults.md)
- [Tooling and generated types](../tooling.md)
- [Backpressure](../backpressure.md)
- [Authentication](../authentication.md)

## Public exports

`sonic-ws` exports the connection/server classes, packet creators and groups, manifests, schema validation, `PacketLogger`, constructor registration, enum helpers, middleware types, and `initializeWasmCore`. The installed `sonicws` CLI inspects manifests and generates packet typings.

The browser bundle exposes the browser `SonicWS` implementation and its helper methods. Internal files under `ws/util`, `native`, and `ws/debug` are not stable package entry points unless specifically exported above.
