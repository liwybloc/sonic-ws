# TypeScript server API

## Options

`new SonicWSServer({ clientPackets, serverPackets, websocketOptions, sonicServerSettings, onSendError, adapter, recovery })`. `onSendError(error, context)` receives failures caught by safe send helpers.

`recovery` accepts `maxDisconnectionMs` (default 120,000) and `maxPackets` (default 1,000). Only packets declared with `replay: true` enter the bounded replay buffer. Replay cannot be combined with packet batching.

`websocketOptions` is passed to `ws.WebSocketServer`. `sonicServerSettings` supports:

- `checkForUpdates` (default true)
- `bit64Hash` (default true) for rereference hashes
- `serveBrowserClient` (default true) to install `/SonicWS/bundle.js` and `/SonicWS/bundle.wasm` routes when an HTTP server is available

## Server methods

- `on_connect(connection)`, `on_recovered(connection, replayed)`, `on_ready(callback)`, `shutdown(callback)`. State and rooms are available in `on_recovered`; the initial `on_connect` occurs before a reconnecting client presents its old session.
- `requireHandshake(tag)`: require one non-batched client packet before all others; repeats are rejected.
- `setClientRateLimit(limit)`, `setServerRateLimit(limit)`: per-connection messages/second. Both default to 500/s. The stored range is an unsigned 16-bit value: zero or values over 65,535 mean unlimited.
- `enablePacket(tag)`, `disablePacket(tag)`: change defaults and all current connections.
- `broadcast(tag, ...values)`, `broadcastFiltered(tag, predicate, ...values)`, `broadcastTagged(connectionTag, packetTag, ...values)`.
- `broadcastRoom(room, packetTag, ...values)`, `broadcastRoomExcept(connection, room, packetTag, ...values)`.
- `broadcastSafe(tag, ...values)` and `broadcastVariant(parent, variant, ...values)`.
- `getConnected()`, `getSocket(id)`, `closeSocket(id, code?, reason?)`.
- `tag(connection, tag, replace = true)`: assign one or multiple broadcast groups.
- `join(connection, room)`, `leave(connection, room)`, `rooms(connection)`.
- `addMiddleware(middleware)`.
- `OpenDebug({ port?, password? })`: launch the TypeScript debug dashboard once.

## `SonicWSConnection`

Server connection methods include `on`, `send`, `sendSafe`, `sendVariant`, `request`, `respond`, `broadcast` (all other users), `broadcastFiltered`, `broadcastRoom`, `join`, `leave`, `getRooms`, packet controls, lifecycle/raw methods, middleware, and `togglePrint`. `handshakeComplete` reports required-handshake state; `id` is unique among currently connected sockets. `state` is restored when connection-state recovery succeeds.

## Scaling adapters

An adapter implements `start(serverId, receiver)`, `publish(message)`, `join(connectionId, room)`, `leave`, `disconnect`, and optional `close`. SonicWS handles local membership and calls the adapter for cross-process room events. Adapter messages carry `{ origin, room, packetTag, values, exceptConnectionId? }`; implementations must transport these values safely and should not echo messages back to their origin.

Close codes 4000–4008 represent rate limit, undersized input, invalid key, invalid packet, invalid data, repeated handshake, disabled packet, middleware rejection, and manual shutdown. `getClosureCause(code)` converts known standard/private codes to names.
