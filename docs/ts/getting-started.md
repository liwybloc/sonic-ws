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

const client = await SonicWS.connect("ws://127.0.0.1:8080", {
  reconnect: { enabled: true },
});
client.on("accepted", accepted => console.log(accepted));
await client.send("chat", "hello");
```

`send()` is asynchronous because schema processing can be queued. Await it when ordering or error handling matters.

## Browser

By default, the Node.js `SonicWSServer` attached to an HTTP server serves `/SonicWS/bundle.js` and `/SonicWS/bundle.wasm`. Automatic asset serving is Node-only. Servers written in Python or another language must serve the files themselves or load the CDN bundle:

```html
<script src="https://cdn.jsdelivr.net/gh/liwybloc/sonic-ws/release/SonicWS_bundle"></script>
```

```html
<script src="/SonicWS/bundle.js"></script>
<script>
  (async () => {
    const socket = await SonicWS.connect(`ws://${location.host}`);
    await socket.send("chat", "hello");
  })();
</script>
```

Call `SonicWS.initialize()` before constructing the first browser client. The bundle first requests its local WASM sibling at `/SonicWS/bundle.wasm` and verifies the response is a real WebAssembly binary. If that file is missing or invalid, it checks jsDelivr's `release/version` against the client's protocol version before loading `release/bundle.wasm`. A missing version file, protocol mismatch, or invalid CDN module rejects initialization with an error.

## Connection lifecycle

The first server message is the compressed schema handshake. A client becomes ready only after its protocol version and both packet tables have been accepted. Register packet listeners before readiness if desired; the client queues those registrations. `on_ready` runs immediately if readiness already occurred. `on_close` observes the underlying WebSocket close event.
