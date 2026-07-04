# Backpressure and delivery

Every connection exposes `getBufferedAmount` and configurable thresholds:

```ts
connection.setBackpressureLimits({
  volatileAtBytes: 1_000_000,
  closeAtBytes: 16_000_000,
});
```

`sendVolatile(tag, value)` returns `false` without encoding when queued outbound data exceeds the volatile threshold. Use it for movement, cursor positions, telemetry samples, and other state that will soon be replaced.

`sendReliable` is an explicit alias for `send`. Reliable does not mean unbounded: reaching the hard threshold closes with code 4009 to prevent a slow client from exhausting process memory.

SonicWS does not automatically coalesce semantic updates. Applications should periodically send an idempotent snapshot and use volatile deltas between snapshots. Important notifications, removals, RPC responses, and authoritative snapshots should remain reliable.

Batching reduces syscall/frame overhead but can increase time spent queued. Do not use batching as a substitute for a backpressure policy.
