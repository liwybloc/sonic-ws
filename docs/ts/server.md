# TypeScript server API

## Options

`new SonicWSServer({ clientPackets, serverPackets, websocketOptions, sonicServerSettings })`.

`websocketOptions` is passed to `ws.WebSocketServer`. `sonicServerSettings` supports:

- `checkForUpdates` (default true)
- `bit64Hash` (default true) for rereference hashes
- `serveBrowserClient` (default true) to install `/SonicWS/bundle.js` and `/SonicWS/bundle.wasm` routes when an HTTP server is available

## Server methods

- `on_connect(connection)`, `on_ready(callback)`, `shutdown(callback)`.
- `requireHandshake(tag)`: require one non-batched client packet before all others; repeats are rejected.
- `setClientRateLimit(limit)`, `setServerRateLimit(limit)`: per-connection messages/second. Both default to 500/s. The stored range is an unsigned 16-bit value: zero or values over 65,535 mean unlimited.
- `enablePacket(tag)`, `disablePacket(tag)`: change defaults and all current connections.
- `broadcast(tag, ...values)`, `broadcastFiltered(tag, predicate, ...values)`, `broadcastTagged(connectionTag, packetTag, ...values)`.
- `getConnected()`, `getSocket(id)`, `closeSocket(id, code?, reason?)`.
- `tag(connection, tag, replace = true)`: assign one or multiple broadcast groups.
- `addMiddleware(middleware)`.
- `OpenDebug({ port?, password? })`: launch the TypeScript debug dashboard once.

## `SonicWSConnection`

Server connection methods include `on`, `send`, `broadcast` (all other users), `broadcastFiltered` (matching other users), `enablePacket`, `disablePacket`, `tag`, `on_close`, `close`, `setName`, `getName`, timer/raw methods, middleware, and `togglePrint`. `handshakeComplete` reports required-handshake state; `id` is unique among currently connected sockets.

Close codes 4000–4008 represent rate limit, undersized input, invalid key, invalid packet, invalid data, repeated handshake, disabled packet, middleware rejection, and manual shutdown. `getClosureCause(code)` converts known standard/private codes to names.
