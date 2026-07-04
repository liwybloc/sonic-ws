# Python client API

## Connect

```py
client = await SonicWS.connect(url, reconnect={"enabled": True}, **websockets_options)
```

Options are forwarded to `websockets.asyncio.client.connect`. A background reader task remains active until close.

## Methods and attributes

- `await send(tag, *values)`
- `await send_variant(parent, variant, *values)` / `sendVariant`
- `await send_safe(tag, *values)` / `sendSafe`, returning a boolean
- `await request(tag, *values, timeout=5.0)` and `respond(tag, handler)` for packet-validated RPC
- `on(tag, listener)` and `off(tag, listener)`
- `on_ready(listener)` / `onReady`; `wait_ready()` / `waitReady`
- `on_close(listener)`
- `await raw_send(data)`, `raw_onmessage(listener)`, `raw_onsend(listener)`
- `await close(code=1000, reason="")`, `is_closed()` / `isClosed()`
- `await set_name(name)`, `get_name()`
- `set_timeout`, `set_interval`, `clear_timeout`, `clear_interval`; returned handles are `asyncio.Task` objects
- `add_middleware`, `await call_middleware(name, *args)`
- `id`, mutable `state`, `client_packets`, `server_packets`, and underlying `socket`
- `on_reconnecting`, `on_reconnect`, `on_reconnect_failed`, and `on_recovered`

Static compatibility helpers are `WrapEnum`, `DeWrapEnum`, `FlattenData`, and `UnFlattenData`.

Packets marked asynchronous can execute while unrelated tags continue. Calls of the same async tag remain serialized. Non-async packets retain receive order.

Handshake failures are propagated directly from `SonicWS.connect()` and `wait_ready()`; they cannot leave callers waiting indefinitely. Later protocol/codec failures close or fail the connection. Put application failures that should not disconnect inside listener-level exception handling.

Reconnect options accept camelCase or snake_case delays: `attempts`, `minDelayMs` / `min_delay_ms`, `maxDelayMs` / `max_delay_ms`, and `jitter`. Reconnect preserves the client object, listeners, middleware, and application state. When the server still has the session, replayable packets, server-side state, and rooms are restored.
