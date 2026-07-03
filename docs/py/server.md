# Python server API

## Construction

```py
server = SonicWSServer(
    client_packets=[...],
    server_packets=[...],
    host="127.0.0.1",
    port=8080,
    **websockets_server_options,
)
```

A TypeScript-shaped settings dictionary is also accepted, including `clientPackets`, `serverPackets`, and `websocketOptions`. Remaining WebSocket options are forwarded to `websockets.asyncio.server.serve`.

## Server methods

- `await start()`, `await shutdown()`, async context-manager support
- `on_connect(callback)`, `on_ready(callback)`
- `require_handshake(packet_tag)`: packet must exist and cannot be batched
- `set_client_rate_limit(limit)`, `set_server_rate_limit(limit)`; both default to 500/s, accept 1…65,535, and treat zero or larger values as unlimited
- `enable_packet(tag)`, `disable_packet(tag)`
- `await broadcast(tag, *values)`
- `await broadcast_filtered(tag, predicate, *values)`
- `await broadcast_tagged(connection_tag, packet_tag, *values)`
- `get_connected()`, `get_socket(id)`, `await close_socket(id, code=1000, reason="")`
- `tag(connection, value, replace=True)`
- `OpenDebug({"port": 0, "password": "..."})`: start a localhost dashboard and return its `DebugServer`; await `wait_ready()` before using its selected port
- `add_middleware`, `await call_middleware`

CamelCase aliases exist for the corresponding TypeScript methods.

## Connection methods

`SonicWSConnection` provides `on`, `off`, `send`, `broadcast` (all other clients), `broadcast_filtered`, `enable_packet`, `disable_packet`, `tag`, raw methods, timers, middleware, names, `on_close`, and `close`. `handshake_complete`, `id`, `tags`, `socket`, and `host` are available.

`toggle_print` / `togglePrint` toggles the connection diagnostic flag. Python applications should normally use middleware or standard logging for structured packet diagnostics.

## Rate limits and packet state

Global limits and per-packet `rateLimit` use rolling one-second windows and unsigned 16-bit limits. Client violations close with code 4000. Server-side excess sends are dropped, matching TypeScript behavior. Disabled client packets close with code 4006. IDs are unique for active connections and released IDs may be reused.

Python includes a lightweight native debug dashboard for connection, name, receive, send, and broadcast events. Automatic browser-bundle serving is only supported by the Node.js server. With Python or another server language, serve the browser artifacts yourself or use the documented CDN script.

```html
<script src="https://cdn.jsdelivr.net/gh/liwybloc/sonic-ws/release/SonicWS_bundle"></script>
```
