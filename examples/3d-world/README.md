# Three.js multiplayer world

```sh
npm install
npm start
```

Open <http://localhost:6726> in two browser windows.

## What SonicWS handles here

- Numeric packet IDs instead of repeated event names
- Binary varint encoding and packet-level quantization
- Movement/look packet variants with object-shaped payloads
- Validation and range checks before handlers
- Volatile movement sends under backpressure
- Row-major snapshot flattening
- Reconnect and bounded session recovery
- Delayed entity removal while a session is recoverable
- Server broadcasts and connection lifecycle state

Movement updates are replaceable and use `sendVolatile`. Snapshots and removal messages use reliable sends. The server delays final removal briefly so an interrupted client can recover its existing entity instead of creating a duplicate.
