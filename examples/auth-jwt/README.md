# JWT authentication

See [`docs/authentication.md`](../../docs/authentication.md) for the canonical Node and Python middleware patterns. Authentication happens during `onClientConnect`; set `state.userId` before recovery is attempted. Recovery rejects a different newly authenticated `userId` by default.
