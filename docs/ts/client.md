# TypeScript client API

## Construction

Node: `new SonicWS(url, wsClientOptions?)`. Browser: `await SonicWS.initialize(); new SonicWS(url, protocols?, antiTamper?)`.

## Methods

- `on(tag, listener)`: listen for a server packet. Values are positional unless `dontSpread` is true.
- `send(tag, ...values): Promise<void>`: validate, encode, optionally rereference/batch/compress, and send a client packet.
- `sendVariant(parent, variant, ...values)`: send a packet-group child.
- `sendSafe(tag, ...values): Promise<boolean>`: catch and report send failures without changing `send`.
- `on_ready(listener)`: run after schema negotiation.
- `on_close(listener)`: observe closure.
- `raw_send(Uint8Array)`: bypass packet framing. Only use for protocol-aware extensions.
- `raw_onmessage(listener)`: observe underlying incoming messages.
- `raw_onsend(listener)`: observe outgoing raw bytes after they are passed to the socket. This is implemented by the shared connection API and also works on server-side connections.
- `close(code = 1000, reason?)`, `isClosed()`.
- `setTimeout`, `setInterval`, `clearTimeout`, `clearInterval`: connection-owned timers cancelled at close. `callOnClose` invokes the callback during closure.
- `addMiddleware(middleware)` and `callMiddleware(method, ...args)`.
- `setName(name)`, `getName()`: names are mainly useful on server-side connections and debugging.
- `state`: mutable application-owned state scoped to the connection.

Browser clients also expose `on_tamper`, `OpenDebug`, `WrapEnum`, `DeWrapEnum`, `FlattenData`, and `UnFlattenData`. DOM debug and anti-tamper functions have no Node equivalent.

Listener exceptions are protocol failures in the current processing path. Keep listeners bounded and catch application errors that should not terminate a connection.
