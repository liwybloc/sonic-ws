# SonicWS for Go

The Go package implements protocol 25 with `coder/websocket` and the shared Rust codec running in `wazero`. It has no cgo requirement.

```sh
go get github.com/liwybloc/sonic-ws/projects/go
```

## Server

```go
move, err := sonicws.NewPacket(sonicws.PacketConfig{
    Tag: "move",
    Fields: []sonicws.Field{{Type: sonicws.VarInt, Min: 2, Max: 2}},
    Schema: []string{"x", "y"},
})
if err != nil {
    log.Fatal(err)
}
clientPackets, _ := sonicws.NewRegistry(move)

server, err := sonicws.NewServer(sonicws.ServerConfig{
    ClientPackets: clientPackets,
    Handler: func(ctx context.Context, conn *sonicws.Conn) {
        for {
            message, err := conn.Receive(ctx)
            if err != nil {
                return
            }
            event := message.(*sonicws.Event)
            log.Printf("%s: %v", event.Tag, event.Values)
        }
    },
})
if err != nil {
    log.Fatal(err)
}
log.Fatal(http.ListenAndServe(":6726", server))
```

## Client

```go
ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
defer cancel()

conn, err := sonicws.Dial(ctx, "ws://127.0.0.1:6726", nil)
if err != nil {
    log.Fatal(err)
}
defer conn.Close(websocket.StatusNormalClosure, "")

err = conn.Send(ctx, "move", map[string]any{"x": 1, "y": -1})
```

`Receive` returns `*Event`, `*Request`, `*Response`, or `*Recovery`. RPC stays on the same ordered receive loop: use `SendRequest` and `Respond` rather than starting an internal dispatcher.

The package supports primitive and object packets, schema mapping, batching, raw DEFLATE, enums, quantization, rereferences, manifests, heartbeats, inbound rate limits, rooms, broadcasts, and bounded session recovery. `Redial` opens a replacement connection and requests recovery from the previous session.

Run the tests from this directory:

```sh
go test ./...
go test -race ./...
```

From the repository root, `./build.sh go-core` rebuilds `internal/core/core.wasm` from `projects/core`. Compatibility peers can run against the other implementations:

```sh
./build.sh test_compat go --host
./build.sh test_compat python --client
```
