# sonic-ws

## INFO

SonicWS is an ultra-lightweight, high-performance WebSocket library focused on maximum bandwidth efficiency, speed, and security.

Compression:
- Lossless compression up to 70% or more (for example, 38kb -> 14kb)
- Optimized bandwidth for many different types to fit special constraints
- Automatic helpers to flatten typed nested arrays for maximum wire efficiency (for example, [[1,false,"text"],[4,true,"other"]] to [[1,4],[false,true],["text,"other"]])
- Uses raw binary bytes to transmit data as efficiently as possible while still using high level readable code
- Built-in ability to use compression libraries

Developer Friendly:
- Predefined data types of various sized integers, single and double precision floating point numbers, strings, enums, etc. and RAW to allow for developers to do anything they want
- Keys are automatically indexed before transfer, improving readability and efficiency (for example, send("pixel") and send("p") use the same bandwidth)
- Data is validated and supports custom validation, ensuring only valid, safe, and untampered packets ever call your listeners
- Edge cases are heavily tested with heavy data ranges; supports code points fully up to the max of 0x10FFFF
- Debug tools to view all packets

Security:
- Tamper-proof; any invalid packet instantly causes closure, and tampering becomes incredibly difficult
- Basic but immensely effective anti-tampering for browser clients
- Built-in ability for handshake packets, preventing repetitive initiation checks in listeners (for example, removes if(!init) everywhere)
- Built-in rate limiting for packets; ability for global send & receive, alongside per-packet rate limiting
- Built-in disabling & enabling of packets to prevent abuse
- Prevents any race conditions; your callbacks will not be called until the last one finishes. (Alongside async options!)
- Prevents niche bugs found in other websocket libraries, such as functions calling after the socket already closed.

Performance & Scaling:
- Can handle very large packets in microseconds
- Can support megabytes of data and millions of values with minimal latency
- Can broadcast to a filtered list of connections such as all, except sender, or any other subset
- Built-in packet batching feature with no boilerplate and with per-client queues and bandwidth efficiency

Developer Experience:
- Minimal boilerplate code due to listeners only receiving valid data
- Enums can map to any primitive value (e.g. number, string, boolean, null) and transmits in 1 byte
- Timers and intervals for sockets that automatically clear upon closure
- Many data types to maximize speed, clarity, bandwidth, and security
- Debug tools for socket ids, byte size, data logging, etc. for troubleshooting
- Very minimal learning curve, easy to work in
- JSDoc's for understanding; immensely intuitive (personally, I took a break for half a year and came back and snapped right back in)
- Almost every case has a pre-made wire optimization and boilerplate removal.

Whether you're making a real-time game, a dashboard, a distributed system, or anything else, SonicWS gets you safe, structured packets; fast.

## SAMPLES

### Importing:
Node (Client & Server):
```js
import { PacketType, SonicWS, SonicWSServer, CreatePacket, CreateObjPacket } from "sonic-ws";
```
Browser (Client):
```html
<script src="https://cdn.jsdelivr.net/gh/liwybloc/sonic-ws/release/SonicWS_bundle.js"></script>
```
*This will always give the latest release build. I will add branches for each release if this project actually goes anywhere.

### Server:
```js
const wss = new SonicWSServer({
    clientPackets: [
        CreatePacket({tag: "pong", type: PacketType.UVARINT, dataMax: 1})
    ],
    serverPackets: [
        CreatePacket({tag: "ping", type: PacketType.UVARINT, dataMax: 1}),
        CreateObjPacket({tag: "data", types: [PacketType.UBYTES, PacketTypes.STRINGS], dataMaxes: [2, 3]})
    ],
    websocketOptions: { port: 1234 }
});

wss.on_connect((socket) => {

    console.log("Socket connection:", socket.id);

    socket.on("pong", (num) => {
        console.log("Ponged!", num);
        socket.send("data", [Math.floor(Math.random() * 26), Math.floor(Math.random() * 256)], ["hello", "from", "server"]);
    });

    socket.setInterval(() => {
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

Some weird error messages when invalid inputs are in like CreatePacket() and stuff

## PLANNED FEATURES

Better error handling

Some middleware support

Debug menus for client/server