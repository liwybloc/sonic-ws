# TypeScript client API

## Construction

Node supports both `new SonicWS(url, wsClientOptions?, reconnectOptions?)` and `await SonicWS.connect(url, options)`. Browser supports `await SonicWS.initialize(); new SonicWS(...)` and `await SonicWS.connect(url, { protocols?, antiTamper?, reconnect?, readyTimeoutMs? })`. The async constructors wait for WASM and schema negotiation; the ready timeout defaults to 10 seconds.

Reconnect is opt-in. Options are `enabled`, `attempts`, `minDelayMs`, `maxDelayMs`, and `jitter`. Backoff is exponential and capped. `on_reconnecting`, `on_reconnect`, and `on_reconnect_failed` expose its lifecycle. An explicit `close()` never reconnects.

## Methods

- `on(tag, listener)`: listen for a server packet. Values are positional unless `dontSpread` is true.
- `send(tag, ...values): Promise<void>`: validate, encode, optionally rereference/batch/compress, and send a client packet.
- `sendVariant(parent, variant, ...values)`: send a packet-group child.
- `sendSafe(tag, ...values): Promise<boolean>`: catch and report send failures without changing `send`.
- `sendVolatile(tag, ...values)`: return false without encoding when queued output exceeds the volatile threshold.
- `sendReliable(tag, ...values)`: explicit `send` alias; the hard backpressure ceiling still applies.
- `request(tag, ...values, { timeoutMs? })`: encode a normal client packet as an RPC request and await its JSON-compatible response.
- `respond(tag, handler)`: answer server-originated RPC requests for a normal server packet.
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
- `getBufferedAmount()`, `setBackpressureLimits(...)`: inspect/configure slow-client handling.
- `on_recovered(({ recovered, replayed }))`: reports whether the previous server session was restored and how many missed packets were replayed.

RPC request payloads still use the packet definition, validation, schema mapping, and quantization. Only the response envelope uses SonicWS JSON encoding. RPC handlers should return JSON-compatible values. A missing responder and a handler exception become rejected request promises.

Browser clients also expose `on_tamper`, `OpenDebug`, `WrapEnum`, `DeWrapEnum`, `FlattenData`, and `UnFlattenData`. DOM debug and anti-tamper functions have no Node equivalent.

Listener exceptions are protocol failures in the current processing path. Keep listeners bounded and catch application errors that should not terminate a connection.
