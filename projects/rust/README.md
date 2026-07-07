# SonicWS for Rust

The Rust package is a native Tokio client and server for SonicWS protocol 25. It uses `sonic-ws-core` directly, so it does not require WebAssembly or a platform-specific shared library.

## Current API

- Protocol-compatible schema negotiation with TypeScript, browser, and Python peers
- Primitive, enum, object, JSON-reserved, compressed, and batched packet framing through the shared core
- Schema-to-`SonicValue::Object` mapping
- Row-major `auto_flatten` and column-major `auto_transpose`
- Packet-level quantization with per-connection error feedback and logical min/max checks
- Packet groups and parent/variant metadata
- Generated `VariantPermutation` groups with boolean-map send and receive helpers
- Async Tokio client and server transports
- Typed incoming events, RPC request/response control frames, rooms, and broadcast helpers
- Rereference packets and first-class connection state
- Per-connection packet gating, global/per-packet rate limits, and message-size limits
- Bounded replay storage, reconnect backoff, state/room restoration, and replay checkpoints
- Bounded raw-DEFLATE decompression inherited from the shared codec

`ServerConfig` enables portable CONTROL heartbeats by default with a 30-second idle interval and 10-second reply timeout. Set `heartbeat_enabled = false` or use a zero interval to disable them. Every inbound packet refreshes liveness; idle clients answer the one-byte `[0]` heartbeat automatically while `recv()` is being driven.

Rust deliberately uses `Result`-returning sends rather than adding a separate `sendSafe` method. The caller decides whether to propagate, log, or ignore each failure.

## Server

```rust,no_run
use sonic_ws::{Packet, PacketRegistry, PacketType, Server, ServerConfig};

#[tokio::main]
async fn main() -> sonic_ws::Result<()> {
    let movement = Packet::builder("movement", PacketType::VarInt)
        .data_range(3, 3)
        .schema(["dx", "dy", "dz"])
        .quantized(1000.0)
        .value_range(Some(-10.0), Some(10.0))
        .build()?;

    let server = Server::bind(
        "127.0.0.1:6726",
        ServerConfig::new(PacketRegistry::new([movement])?, PacketRegistry::default()),
    ).await?;

    server.on_with_connection("movement", |connection, event| async move {
        println!("{} sent {:?}", connection.id(), event.value);
    });
    server.run().await
}
```

## Listeners and manual receiving

The high-level server API supports async listeners:

```rust,no_run
# use sonic_ws::{PacketRegistry, Server, ServerConfig};
# async fn example() -> sonic_ws::Result<()> {
# let server = Server::bind("127.0.0.1:0", ServerConfig::new(PacketRegistry::default(), PacketRegistry::default())).await?;
server.on("notification", |event| async move {
    println!("{:?}", event.value);
});
server.on_connect(|connection| async move {
    println!("connected: {}", connection.id());
});
server.run().await?;
# Ok(())
# }
```

Use `Listeners` with a client or one manually accepted connection. `Connection::recv` and `Server::recv` remain available when an application needs direct ordered message handling, RPC request matching, or custom dispatch. Rust closures use `async move` rather than JavaScript's `async packet => {}` syntax, but provide the same listener model.

## Client

```rust,no_run
use sonic_ws::{Client, SonicValue};

# async fn example() -> sonic_ws::Result<()> {
let client = Client::connect("ws://127.0.0.1:6726").await?;
client.send("movement", &SonicValue::Object(vec![
    ("dx".into(), SonicValue::F64(0.25)),
    ("dy".into(), SonicValue::F64(0.0)),
    ("dz".into(), SonicValue::F64(-0.5)),
])).await?;
# Ok(())
# }
```

## RPC

`request` returns the generated request ID. A matching `Incoming::Response` is delivered by `recv`. A peer receives `Incoming::Request` and answers with `respond(request.id, result)`.

This design does not hide normal packet events behind a request future. One receive loop remains the single ordered source of network messages.

## Variant permutations

```rust,no_run
use sonic_ws::{Packet, PacketType, SonicValue, VariantPermutation, permutation_packet_group};

# async fn example(connection: sonic_ws::Connection) -> sonic_ws::Result<()> {
let permutation = VariantPermutation::wasd();
let packets = permutation_packet_group(
    "movement",
    &permutation,
    Packet::builder("template", PacketType::Shorts).build()?,
)?;

connection.send_permutation_flags(
    "movement",
    &[true, true, false, false],
    &SonicValue::I64(5),
).await?;
# Ok(())
# }
```

The selected packet is `movement.W,A`. Received `Event` values include the generated variant and a `permutation: Option<HashMap<String, bool>>`. Use `send_permutation_map` when keyed flags are clearer.

## Recovery

Save `connection.session_id()` and `connection.recovery_checkpoint()` before replacing a disconnected client. `Client::reconnect` retries with exponential backoff and sends the resume control frame. On the server, use `server.recv(&connection)` to handle resume frames automatically before returning application messages. `connection.recv()` remains available when an application wants to process `Incoming::Resume` itself and call `server.resume(...)` explicitly.

Replay storage is bounded by `ServerConfig::max_replay_packets` and expires after `ServerConfig::recovery_duration`. Only packets built with `.replay(true)` enter that buffer.

## Compatibility boundaries

The wire protocol and codec are compatible with the other runtimes. Runtime-specific conveniences remain idiomatic to each language: Rust exposes streams of `Incoming` values instead of JavaScript callbacks, and Rust applications construct typed domain objects after decoding rather than negotiating class names and evaluating constructors.

Rust reconnect is explicit rather than silently replacing a `Connection` behind active Rust tasks: `Client::reconnect` returns the replacement connection after retrying and sending its recovery request. Applications retain control over task ownership and authentication while state, rooms, sequence numbers, and replayable packets are restored by the server.

## Testing

```sh
cargo test --manifest-path projects/rust/Cargo.toml
```

Public integration tests live in `projects/rust/tests`. `test_compat.rs` sends every packet mode, object frames, compressed packets, and batches in both directions. The remaining suites cover schema negotiation, mappings, transposition, quantization residuals, JSON packets/control values, malformed schemas, limits, packet gating, listeners, RPC, rooms, reconnect recovery, and loopback client/server exchange.
