# sonic-ws

## INFO

WebSocket library focused on bandwidth efficiency and security.

It can reduce packet size by up to 70% and process large packets in microseconds.

It has low latency and optimized data transfer.

While still simple and efficient, SonicWS provides efficient packet transfers.

## SAMPLES

### Importing:
Node (Client & Server):
```js
import { PacketType, SonicWS, SonicWSServer, CreatePacket } from "sonic-ws";
```
Browser (Client):
```html
<script src="https://cdn.jsdelivr.net/gh/cutelittlelily/sonic-ws/release/SonicWS_bundle.js"></script>
```
*This will always give the latest release build. I will add branches for each release if this project actually goes anywhere.

### Server:
```js
const wss = new SonicWSServer(
    [CreatePacket("pong", PacketType.INTS_D, 1)], // client-sent packets
    [CreatePacket("ping", PacketType.INTS_D, 1)], // server-sent packets
    { port: 1234 }
);

wss.on_connect((socket) => {

    console.log("Socket connection:", socket.id);

    socket.on("pong", (num) => {
        console.log("Ponged!", num);
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

ws.on_close((event) => {
    console.log("closed client: " + event.code);
});
```

## KNOWN ISSUES

Can't send 0 values through stuff like STRINGS; processes as [""] instead of []

## PLANNED FEATURES

Custom packet structures; ability to send x strings, y numbers, etc.