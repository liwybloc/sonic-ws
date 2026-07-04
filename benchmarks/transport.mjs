import { performance } from "node:perf_hooks";
import { mkdir, writeFile } from "node:fs/promises";
import WS, { WebSocketServer } from "../node_modules/ws/wrapper.mjs";
import { SonicWS, SonicWSServer, CreatePacket, PacketType } from "../projects/ts/dist/index.js";

const iterations = Number(process.env.SONIC_TRANSPORT_ITERATIONS ?? 2_000);
const pct = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
const summarize = (name, samples, sentBytes) => {
    samples.sort((a, b) => a - b);
    return { name, iterations, applicationBytesSent: sentBytes, averageApplicationBytes: sentBytes / iterations,
        latencyMilliseconds: { p50: pct(samples, .5), p95: pct(samples, .95), p99: pct(samples, .99) } };
};

async function rawJson() {
    const server = new WebSocketServer({ host: "127.0.0.1", port: 0, maxPayload: 8 * 1024 * 1024 });
    server.on("connection", socket => socket.on("message", data => socket.send(data)));
    await new Promise(resolve => server.once("listening", resolve));
    const client = new WS(`ws://127.0.0.1:${server.address().port}`);
    await new Promise((resolve, reject) => { client.once("open", resolve); client.once("error", reject); });
    const samples = []; let bytes = 0;
    for (let id = 0; id < iterations; id++) {
        const payload = JSON.stringify({ event: "movement.move", data: { dx: .125, dy: 0, dz: -.25 }, id });
        bytes += Buffer.byteLength(payload);
        const start = performance.now();
        const received = new Promise(resolve => client.once("message", resolve));
        client.send(payload); await received; samples.push(performance.now() - start);
    }
    client.close(); await new Promise(resolve => server.close(resolve));
    return summarize("raw ws + JSON echo", samples, bytes);
}

async function sonic() {
    const ping = CreatePacket({ tag: "movement.move", type: PacketType.VARINT, schema: ["dx", "dy", "dz"], dataMax: 3, quantized: { scale: 1000, trackError: false } });
    const pong = CreatePacket({ tag: "ack", type: PacketType.UVARINT });
    const server = new SonicWSServer({ clientPackets: [ping], serverPackets: [pong], websocketOptions: { host: "127.0.0.1", port: 0 }, sonicServerSettings: { checkForUpdates: false } });
    await new Promise(resolve => server.on_ready(resolve));
    server.on_connect(connection => connection.on("movement.move", () => connection.send("ack", 1)));
    const client = await SonicWS.connect(`ws://127.0.0.1:${server.wss.address().port}`);
    let resolveAck; client.on("ack", () => resolveAck?.());
    let bytes = 0; client.raw_onsend(frame => bytes += frame.length);
    const samples = [];
    for (let id = 0; id < iterations; id++) {
        const received = new Promise(resolve => resolveAck = resolve);
        const start = performance.now();
        await client.send("movement.move", { dx: .125, dy: 0, dz: -.25 });
        await received; samples.push(performance.now() - start);
    }
    client.close(); await new Promise(resolve => server.shutdown(resolve));
    return summarize("SonicWS validated binary echo", samples, bytes);
}

const results = [await rawJson(), await sonic()];
const unavailable = [];
for (const packageName of ["socket.io", "uWebSockets.js"]) {
    try { await import(packageName); }
    catch { unavailable.push(`${packageName} adapter skipped: package is not installed`); }
}
const report = { generatedAt: new Date().toISOString(), node: process.version, platform: `${process.platform}/${process.arch}`, results, unavailable };
await mkdir(new URL("./results/", import.meta.url), { recursive: true });
await writeFile(new URL("./results/transport-latest.json", import.meta.url), JSON.stringify(report, null, 2));
console.table(results.map(result => ({ benchmark: result.name, bytes: result.averageApplicationBytes.toFixed(1), p50: result.latencyMilliseconds.p50.toFixed(3), p95: result.latencyMilliseconds.p95.toFixed(3), p99: result.latencyMilliseconds.p99.toFixed(3) })));
unavailable.forEach(message => console.warn(message));
