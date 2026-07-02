# TypeScript middleware

Add middleware with `connection.addMiddleware(object)` or `server.addMiddleware(object)`. Optional `init(holder)` runs once. Hook errors are logged and isolated. Returning true from a cancellable hook cancels that operation.

Connection hooks:

- `onReceive_pre(tag, rawData, receivedSize)`
- `onReceive_post(tag, decodedValues)`
- `onSend_pre(tag, values, Date.nowValue, performanceNowValue)`
- `onSend_post(tag, encodedData, sentSize)`
- `onStatusChange(readyState)`
- `onNameChange(name)`

Server hooks:

- `onClientConnect(connection)`; true rejects it with close code 4007
- `onClientDisconnect(connection, code, reason)`
- `onPacketBroadcast_pre(tag, info, ...values)`
- `onPacketBroadcast_post(tag, info, encodedData, sentSize)`

`BCInfo` contains `recipients` and one target descriptor: `{type: "all"}`, `{type: "tagged", tag}`, or `{type: "filter", filter}`. The recipient list is computed before hooks run.
