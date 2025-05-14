# sonic-ws

## INFO

WebSocket library focused on bandwidth efficiency and security.

It can reduce packet size by up to 70% or more and validate and process large packets in microseconds.

It has low latency and optimized data transfer.

Helper functions for frequent cases are included to reduce dev boilerplate.

## SAMPLES

### Importing:
Node (Client & Server):
```js
import { PacketType, SonicWS, SonicWSServer, CreatePacket, CreateObjPacket } from "sonic-ws";
```
Browser (Client):
```html
<script src="https://cdn.jsdelivr.net/gh/cutelittlelily/sonic-ws/release/SonicWS_bundle.js"></script>
```
*This will always give the latest release build. I will add branches for each release if this project actually goes anywhere.

### Server:
```js
const wss = new SonicWSServer({
    clientPackets: [
        CreatePacket({tag: "pong", type: PacketType.INTS_D, dataMax: 1})
    ],
    serverPackets: [
        CreatePacket({tag: "ping", type: PacketType.INTS_D, dataMax: 1}),
        CreateObjPacket({tag: "data", types: [PacketType.INTS_A, PacketTypes.STRING], dataMaxes: [2, 3]})
    ],
    websocketOptions: { port: 1234 }
});

wss.on_connect((socket) => {

    console.log("Socket connection:", socket.id);

    socket.on("pong", (num) => {
        console.log("Ponged!", num);
        socket.send("data", [Math.floor(Math.random() * 1000), Math.floor(Math.random() * 1000)], ["hello", "from", "server"]);
    });

    setInterval(() => {
        socket.send("ping", Date.now());
    }, 10000);

});

wss.on_ready(() => {
    console.log("Server ready!");
});
```

### Client:
```js
const ws = new SonicWS("ws://localhost:1234");

ws.on_ready(() => {
    console.log("Connected to server");
});

ws.on("ping", (num) => {
    console.log("Pinged!", num);
    ws.send("pong", Date.now());
})
ws.on("data", (i, s) => {
    console.log("data: ", i);
    console.log("message: " + s.join(" "));
});

ws.on_close((event) => {
    console.log("closed client: " + event.code);
});
```

## KNOWN ISSUES

## PLANNED FEATURES

More data checking and better error handling

Layered object packets

JSDoc'ing stuff

Possibilities of nested objects; however these are inefficient to do than just a flat one