# sonic-ws

## INFO

Sonic WS is an ultra-lightweight, high-performance, and bandwidth efficient websocket library.

Compression:
- Can reduce packet size by up to 70%+ (for example, 38kb -> 14kb)
- Optimized bandwidth for many different types to fit special constraints
- Automatic helpers to flatten nested arrays for maximum wire efficiency

Developer Friendly:
- Predefined data types of various sized integers, decimals, strings, enums, etc. and RAW for any special cases
- Keys are automatically indexed before transfer, improving readability (for example, send("pixel") and send("p") become identical)
- Data is validated and supports custom validation, ensuring only valid, safe, and untampered packets ever call your listeners

Security:
- Tamper-proof; any invalid packet instantly causes closure, and tampering is very likely to as well
- Built-in ability for handshake packets, preventing constant if(!init) checks and null checks in every listener
- Built-in rate limiting for packets

Performance & Scaling:
- Can handle very large packets in microseconds
- Can support megabytes of data with minimal latency
- Can broadcast to a filtered list of connections such as all, except sender, or any other subset
- Built-in packet batching feature with no boilerplate and with per-client queues and bandwidth efficiency

Developer Experience:
- Minimal boilerplate code due to listeners only receiving valid data
- Enums can map to any primitive value, such as numbers, strings, null, etc. in 1 byte
- Timers and intervals for sockets that automatically clear upon closure
- Debug tools for socket ids, byte size, data logging, etc. for troubleshooting
- JSDoc's for understanding* (soon to be complete)

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

some stack size things idkk

## PLANNED FEATURES

More data checking and better error handling

Layered object packets

JSDoc'ing stuff

Possibilities of nested objects; however these are inefficient to do than just a flat one

Rate limiting per-packet
