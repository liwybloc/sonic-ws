import { performance } from "node:perf_hooks";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import WS, { WebSocketServer } from "../node_modules/ws/wrapper.mjs";
import { SonicWS, SonicWSServer, CreatePacket, PacketType } from "../projects/ts/dist/index.js";

const iterations = Number(process.env.SONIC_TRANSPORT_ITERATIONS ?? 2_000);
async function installedVersion(name) {
    try {
        const packageUrl = new URL(`./node_modules/${name}/package.json`, import.meta.url);
        const data = JSON.parse(await readFile(packageUrl, "utf8"));
        return data.version;
    } catch {
        return null;
    }
}

const pct = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
const summarize = (name, samples, sentBytes, responseBytes) => {
    samples.sort((a, b) => a - b);

    return {
        name,
        iterations,
        applicationBytesSent: sentBytes,
        averageRequestBytes: sentBytes / iterations,
        averageResponseBytes: responseBytes / iterations,
        averageRoundTripApplicationBytes: (sentBytes + responseBytes) / iterations,
        latencyMilliseconds: {
            p50: pct(samples, .5),
            p95: pct(samples, .95),
            p99: pct(samples, .99),
        },
    };
};

async function rawJson() {
    const server = new WebSocketServer({
        host: "127.0.0.1",
        port: 0,
        maxPayload: 8 * 1024 * 1024,
    });
    const acknowledgement = JSON.stringify({ event: "ack", data: 1 });

    server.on("connection", socket => socket.on("message", data => {
        JSON.parse(data.toString());
        socket.send(acknowledgement);
    }));

    await new Promise(resolve => server.once("listening", resolve));

    const client = new WS(`ws://127.0.0.1:${server.address().port}`);
    await new Promise((resolve, reject) => {
        client.once("open", resolve);
        client.once("error", reject);
    });

    const samples = [];
    let bytes = 0;

    for (let iteration = 0; iteration < iterations; iteration++) {
        const payload = JSON.stringify({
            event: "movement.move",
            data: { dx: .125, dy: 0, dz: -.25 },
        });
        bytes += Buffer.byteLength(payload);

        const start = performance.now();
        const received = new Promise(resolve => client.once("message", resolve));
        client.send(payload);
        await received;
        samples.push(performance.now() - start);
    }

    client.close();
    await new Promise(resolve => server.close(resolve));

    return summarize(
        "raw ws + JSON event/ack",
        samples,
        bytes,
        Buffer.byteLength(acknowledgement) * iterations,
    );
}

async function socketIo() {
    const [{ Server }, { io }] = await Promise.all([
        import("socket.io"),
        import("socket.io-client"),
    ]);
    const server = new Server(0, {
        transports: ["websocket"],
        serveClient: false,
        perMessageDeflate: false,
    });
    await new Promise(resolve => server.httpServer.once("listening", resolve));
    server.on("connection", socket => {
        socket.on("movement.move", () => socket.emit("ack", 1));
    });

    const client = io(`ws://127.0.0.1:${server.httpServer.address().port}`, {
        transports: ["websocket"],
        upgrade: false,
        reconnection: false,
        forceNew: true,
    });
    await new Promise((resolve, reject) => {
        client.once("connect", resolve);
        client.once("connect_error", reject);
    });

    const value = { dx: .125, dy: 0, dz: -.25 };
    const requestBytes = Buffer.byteLength(`42${JSON.stringify(["movement.move", value])}`);
    const samples = [];
    for (let iteration = 0; iteration < iterations; iteration++) {
        const received = new Promise(resolve => client.once("ack", resolve));
        const start = performance.now();
        client.emit("movement.move", value);
        await received;
        samples.push(performance.now() - start);
    }
    client.disconnect();
    await new Promise(resolve => server.close(resolve));

    const responseBytes = Buffer.byteLength(`42${JSON.stringify(["ack", 1])}`);
    return summarize(
        "Socket.IO WebSocket event/ack",
        samples,
        requestBytes * iterations,
        responseBytes * iterations,
    );
}

async function uWebSocketsJson() {
    const uWS = await import("uwebsockets/ESM_wrapper.mjs");
    let token;
    const app = uWS.App().ws("/*", {
        compression: uWS.DISABLED,
        maxPayloadLength: 8 * 1024 * 1024,
        idleTimeout: 120,
        message: (socket, message) => {
            JSON.parse(Buffer.from(message).toString());
            socket.send(JSON.stringify({ event: "ack", data: 1 }), false);
        },
    });
    const port = await new Promise((resolve, reject) => {
        app.listen("127.0.0.1", 0, listenToken => {
            if (!listenToken) {
                reject(new Error("uWebSockets.js failed to listen"));
                return;
            }

            token = listenToken;
            resolve(uWS.us_socket_local_port(listenToken));
        });
    });

    const client = new WS(`ws://127.0.0.1:${port}`);
    await new Promise((resolve, reject) => {
        client.once("open", resolve);
        client.once("error", reject);
    });

    const samples = [];
    let bytes = 0;

    for (let iteration = 0; iteration < iterations; iteration++) {
        const payload = JSON.stringify({
            event: "movement.move",
            data: { dx: .125, dy: 0, dz: -.25 },
        });
        bytes += Buffer.byteLength(payload);

        const received = new Promise(resolve => client.once("message", resolve));
        const start = performance.now();
        client.send(payload);
        await received;
        samples.push(performance.now() - start);
    }
    client.close();
    uWS.us_listen_socket_close(token);

    const responseBytes = Buffer.byteLength(JSON.stringify({ event: "ack", data: 1 })) * iterations;
    return summarize("uWebSockets.js + JSON event/ack", samples, bytes, responseBytes);
}

async function sonic() {
    const ping = CreatePacket({
        tag: "movement.move",
        type: PacketType.VARINT,
        schema: ["dx", "dy", "dz"],
        dataMax: 3,
        quantized: { scale: 1000, trackError: false },
    });
    const pong = CreatePacket({ tag: "ack", type: PacketType.UVARINT });

    const server = new SonicWSServer({
        clientPackets: [ping],
        serverPackets: [pong],
        websocketOptions: { host: "127.0.0.1", port: 0 },
        sonicServerSettings: { checkForUpdates: false },
    });
    await new Promise(resolve => server.on_ready(resolve));

    server.on_connect(connection => connection.on("movement.move", () => connection.send("ack", 1)));

    const client = await SonicWS.connect(`ws://127.0.0.1:${server.wss.address().port}`);
    let resolveAck;
    client.on("ack", () => resolveAck?.());

    let bytes = 0;
    client.raw_onsend(frame => bytes += frame.length);

    const samples = [];
    for (let iteration = 0; iteration < iterations; iteration++) {
        const received = new Promise(resolve => resolveAck = resolve);
        const start = performance.now();

        await client.send("movement.move", { dx: .125, dy: 0, dz: -.25 });
        await received;
        samples.push(performance.now() - start);
    }

    client.close();
    await new Promise(resolve => server.shutdown(resolve));

    return summarize("SonicWS validated binary event/ack", samples, bytes, 2 * iterations);
}

const results = [await rawJson()];
const unavailable = [];
for (const [name, benchmark] of [
    ["Socket.IO", socketIo],
    ["uWebSockets.js", uWebSocketsJson],
    ["SonicWS", sonic],
]) {
    try {
        results.push(await benchmark());
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        unavailable.push(`${name} benchmark skipped: ${message}`);
    }
}

async function readVersion(url) {
    return JSON.parse(await readFile(new URL(url, import.meta.url), "utf8")).version;
}

const report = {
    generatedAt: new Date().toISOString(),
    node: process.version,
    platform: `${process.platform}/${process.arch}`,
    iterations,
    packageVersions: {
        ws: await readVersion("../node_modules/ws/package.json"),
        socketIo: await installedVersion("socket.io"),
        socketIoClient: await installedVersion("socket.io-client"),
        uWebSockets: await installedVersion("uwebsockets"),
        sonicWs: await readVersion("../projects/ts/package.json"),
    },
    settings: "Loopback, sequential request/response, WebSocket transport only, compression disabled",
    results,
    unavailable,
};

await mkdir(new URL("./results/", import.meta.url), { recursive: true });
await writeFile(new URL("./results/transport-latest.json", import.meta.url), JSON.stringify(report, null, 2));

console.table(results.map(result => ({
    benchmark: result.name,
    requestBytes: result.averageRequestBytes.toFixed(1),
    responseBytes: result.averageResponseBytes.toFixed(1),
    roundTripBytes: result.averageRoundTripApplicationBytes.toFixed(1),
    p50: result.latencyMilliseconds.p50.toFixed(3),
    p95: result.latencyMilliseconds.p95.toFixed(3),
    p99: result.latencyMilliseconds.p99.toFixed(3),
})));

unavailable.forEach(message => console.warn(message));
