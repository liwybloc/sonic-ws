# Authentication and recovery

SonicWS intentionally does not choose an identity provider. Authenticate the HTTP upgrade before registering packet listeners, then place a stable identity in connection state.

## Node pattern

```ts
const server = new SonicWSServer({
  clientPackets,
  serverPackets,
  websocketOptions: { server: httpServer },
  recovery: {
    authorize(previous, current) {
      return previous.userId === current.userId;
    },
  },
});

server.addMiddleware({
  onClientConnect(connection) {
    const token = connection.upgradeRequest.headers.authorization?.replace(/^Bearer /, "");
    const claims = verifyJwt(token); // your JWT library and issuer/audience checks
    if (!claims) return true;
    connection.state.userId = claims.sub;
  },
});

server.on_connect(connection => {
  connection.join(`user:${connection.state.userId}`);
});

server.on_recovered(connection => {
  // state and rooms have now been restored and authorization has succeeded
});
```

## Python pattern

```py
class Authentication:
    async def onClientConnect(self, connection):
        authorization = connection.upgrade_request.headers.get("Authorization", "")
        claims = verify_jwt(authorization.removeprefix("Bearer "))
        if claims is None:
            return True
        connection.state["userId"] = claims["sub"]

server = SonicWSServer(
    client_packets=client_packets,
    recovery={"authorize": lambda previous, current, _connection:
        previous.get("userId") == current.get("userId")},
)
server.add_middleware(Authentication())
```

The default recovery policy already rejects restoration when an old `state.userId` differs from the newly authenticated `state.userId`. An explicit callback is recommended when identity includes tenant, device, token version, logout epoch, or permission state.

Never treat the reconnect session ID as the user's primary authentication credential. Use TLS, validate token issuer/audience/expiry, rotate compromised credentials, and rate-limit authentication failures outside packet rate limiting.
