# TypeScript getting started

## Node

```ts
import {
  SonicWS, SonicWSServer, PacketType, CreatePacket,
} from "sonic-ws";

const clientPackets = [
  CreatePacket({ tag: "chat", type: PacketType.STRINGS_UTF16, dataMax: 1 }),
];
const serverPackets = [
  CreatePacket({ tag: "accepted", type: PacketType.BOOLEANS, dataMax: 1 }),
];

const server = new SonicWSServer({
  clientPackets,
  serverPackets,
  websocketOptions: { port: 8080 },
  sonicServerSettings: { checkForUpdates: false },
});

server.on_connect(connection => {
  connection.on("chat", text => connection.send("accepted", text.length > 0));
});

const client = new SonicWS("ws://127.0.0.1:8080");
client.on("accepted", accepted => console.log(accepted));
client.on_ready(() => client.send("chat", "hello"));
```

`send()` is asynchronous because schema processing can be queued. Await it when ordering or error handling matters.

## Browser

By default, a `SonicWSServer` attached to an HTTP server serves `/SonicWS/bundle.js` and `/SonicWS/bundle.wasm`.

```html
<script src="/SonicWS/bundle.js"></script>
<script>
  (async () => {
    await SonicWS.initialize();
    const socket = new SonicWS(`ws://${location.host}`);
    socket.on_ready(() => socket.send("chat", "hello"));
  })();
</script>
```

Call `SonicWS.initialize()` before constructing the first browser client. The bundle requests its WASM sibling at `/SonicWS/bundle.wasm`.

## Connection lifecycle

The first server message is the compressed schema handshake. A client becomes ready only after its protocol version and both packet tables have been accepted. Register packet listeners before readiness if desired; the client queues those registrations. `on_ready` runs immediately if readiness already occurred. `on_close` observes the underlying WebSocket close event.
