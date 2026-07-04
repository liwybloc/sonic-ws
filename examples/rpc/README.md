# RPC

```js
connection.respond("player.rename", async ({ name }) => {
  await renamePlayer(connection.state.userId, name);
  return { ok: true };
});

const result = await client.request("player.rename", { name: "Lily" }, { timeoutMs: 3000 });
```

The request uses the normal packet definition and validation. The response must be JSONUtil-compatible. Use ordinary `send` for one-way events.
