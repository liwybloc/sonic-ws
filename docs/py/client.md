# Python client API

## Connect

```py
client = await SonicWS.connect(url, **websockets_options)
```

Options are forwarded to `websockets.asyncio.client.connect`. A background reader task remains active until close.

## Methods and attributes

- `await send(tag, *values)`
- `await send_variant(parent, variant, *values)` / `sendVariant`
- `await send_safe(tag, *values)` / `sendSafe`, returning a boolean
- `on(tag, listener)` and `off(tag, listener)`
- `on_ready(listener)` / `onReady`; `wait_ready()` / `waitReady`
- `on_close(listener)`
- `await raw_send(data)`, `raw_onmessage(listener)`, `raw_onsend(listener)`
- `await close(code=1000, reason="")`, `is_closed()` / `isClosed()`
- `await set_name(name)`, `get_name()`
- `set_timeout`, `set_interval`, `clear_timeout`, `clear_interval`; returned handles are `asyncio.Task` objects
- `add_middleware`, `await call_middleware(name, *args)`
- `id`, mutable `state`, `client_packets`, `server_packets`, and underlying `socket`

Static compatibility helpers are `WrapEnum`, `DeWrapEnum`, `FlattenData`, and `UnFlattenData`.

Packets marked asynchronous can execute while unrelated tags continue. Calls of the same async tag remain serialized. Non-async packets retain receive order.

Handshake failures are propagated directly from `SonicWS.connect()` and `wait_ready()`; they cannot leave callers waiting indefinitely. Later protocol/codec failures close or fail the connection. Put application failures that should not disconnect inside listener-level exception handling.
