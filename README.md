# sonic-ws

### WebSockets that handle correctness, security, and performance for you

- No race conditions
- No invalid packets
- No accidental DoS
- No cleanup bugs
- No boilerplate
- Many built-in security features
- Lower bandwidth cost
- Works much better on mobile
- More readable than every other socket library

<details>
<summary>DETAILED INFO</summary>

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
</details>

## SAMPLES

### Node (Client & Server)
```js
import { SonicWS, SonicWSServer, CreatePacket, PacketType } from "sonic-ws";
```

Browser (Client):
```html
<script src="https://cdn.jsdelivr.net/gh/liwybloc/sonic-ws/release/SonicWS_bundle"></script>
```
*This will always give the latest release build. I will add branches for each release if this project actually goes anywhere.

### Simple Example: Clicker Server

#### Server
```js
const wss = new SonicWSServer({
    clientPackets: [
        CreatePacket({ tag: "click", type: PacketType.NONE }),
        CreatePacket({ tag: "token", type: PacketType.STRINGS }),
    ],
    serverPackets: [
        CreatePacket({ tag: "pointsInfo", type: PacketType.UVARINT }),
        CreatePacket({ tag: "notification", type: PacketType.STRINGS }),
    ],
    websocketOptions: { port: 1234 },
});

wss.requireHandshake("token");

wss.on_connect(ws => {
    console.log("Client connected:", ws.id);

    let clicks = 0;

    ws.on("token", token => {
        if(!isValidToken(token)) // No listeners will ever trigger after this, unlike base websocket
            return socket.close();
    })

    // auto validation, no boilerplate. always passed the token check
    ws.on("click", () => {
        ws.send("pointsInfo", ++clicks);
    });

    ws.setInterval(() => ws.send("notification", "Keep going!"), 5000); // auto cleanup on close
});

wss.on_ready(() => console.log("Server ready!"));
```

#### Client
```js
const ws = new SonicWS("ws://localhost:1234");

ws.on_ready(() => console.log("Connected to server"));

ws.on("pointsInfo", clicks => console.log("Total Clicks: ", clicks));

ws.on("notification", msg => console.log("Notification:", msg));

button.addEventListener("click", () => {
    ws.send("click");
});

```

## KNOWN ISSUES

## PLANNED FEATURES
- Better encoding for the first packet that sends packet information
- Support for other languages: Python, Go, Rust

## LICENSE
This project is source-available.

You are free to use, modify, and contribute for personal,
non-commercial purposes.

Commercial use requires a separate license. Please contact me regarding information on this.
