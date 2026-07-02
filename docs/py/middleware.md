# Python middleware

Subclassing is optional, but base classes improve intent:

```py
from sonic_ws import ConnectionMiddleware

class Metrics(ConnectionMiddleware):
    def init(self, holder):
        self.holder = holder

    async def onReceive_post(self, tag, values):
        print(tag, values)
```

Install with `add_middleware` / `addMiddleware`. Hook names intentionally match TypeScript for cross-language middleware design. Sync and async hooks are supported. Exceptions are logged and isolated. Returning truthy from a cancellable hook cancels the operation.

Connection hooks: `onReceive_pre`, `onReceive_post`, `onSend_pre`, `onSend_post`, `onStatusChange`, and `onNameChange`.

Server hooks: `onClientConnect`, `onClientDisconnect`, `onPacketBroadcast_pre`, and `onPacketBroadcast_post`.

Broadcast hooks receive a `BCInfo`, a dictionary supporting attribute access. It contains `type`, `recipients`, and, where relevant, `tag` or `filter`. The post hook runs after encoding but before delivery and may cancel delivery.

Middleware should be fast. Async receive packets allow unrelated tags to progress, but expensive CPU work should still move to an executor or worker.
