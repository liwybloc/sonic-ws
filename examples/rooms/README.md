# Rooms

```js
server.on_connect(connection => connection.join("lobby"));
await server.broadcastRoom("lobby", "notification", "Welcome");
await connection.broadcastRoom("lobby", "entity.move", movement);
```

Rooms are server-owned. Add an adapter to forward room operations across processes; do not let clients select authorization-sensitive rooms without validating membership first.
