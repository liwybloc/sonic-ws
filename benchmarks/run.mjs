import { performance } from "node:perf_hooks";
import { deflateRawSync } from "node:zlib";
import { writeFile, mkdir } from "node:fs/promises";
import {
    CreatePacket, PacketType,
} from "../projects/ts/dist/index.js";
import { encodeNativeBatch, loadNativeCore } from "../projects/ts/dist/native/wrapper.js";
import { toPacketBuffer } from "../projects/ts/dist/ws/util/BufferUtil.js";

const iterations = Number(process.env.SONIC_BENCH_ITERATIONS ?? 20_000);
const encoder = new TextEncoder();
const nativeCore = loadNativeCore();

const scenarios = [
    {
        name: "movement.move",
        packet: CreatePacket({ tag: "movement.move", type: PacketType.VARINT, schema: ["dx", "dy", "dz"], dataMax: 3, quantized: { scale: 1000, trackError: false } }),
        value: { dx: .125, dy: 0, dz: -.25 },
    },
    {
        name: "movement.look",
        packet: CreatePacket({ tag: "movement.look", type: PacketType.VARINT, schema: ["dPitch", "dYaw"], dataMax: 2, quantized: { scale: 1000, trackError: false } }),
        value: { dPitch: .01, dYaw: -.03 },
    },
    {
        name: "chat",
        packet: CreatePacket({ tag: "chat", type: PacketType.STRINGS_UTF16 }),
        value: "hello from SonicWS",
    },
    {
        name: "entitySnapshot.100",
        packet: CreatePacket({ tag: "entitySnapshot", type: PacketType.VARINT, schema: ["id", "type", "x", "y", "z", "pitch", "yaw"], autoFlatten: true, quantized: { scale: 1000, trackError: false } }),
        value: Array.from({ length: 100 }, (_, id) => ({ id, type: 0, x: id * .25, y: 1.7, z: id * -.5, pitch: 0, yaw: id * .01 })),
    },
];

function sonicFrame(packet, value) {
    const values = packet.autoFlatten || packet.fields ? [value] : [value];
    const prepared = packet.prepareSend(values, 0);
    const payload = prepared.length ? packet.processSend(prepared) : new Uint8Array();
    if (payload instanceof Promise) throw new Error("Benchmark requires a synchronous codec path");
    return toPacketBuffer(1, payload);
}

function jsonFrame(name, value) {
    return encoder.encode(JSON.stringify({ event: name, data: value }));
}

function varint(value) {
    const bytes = [];
    do {
        let byte = value & 0x7f;
        value >>>= 7;
        if (value) byte |= 0x80;
        bytes.push(byte);
    } while (value);
    return Buffer.from(bytes);
}

function percentile(sorted, value) {
    return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * value))];
}

function finishMeasurement(label, samples, elapsedMs, cpu, heapBefore, mode) {
    samples.sort((a, b) => a - b);
    return {
        label, mode, iterations,
        operationsPerSecond: iterations / (elapsedMs / 1000),
        latencyMicroseconds: { p50: percentile(samples, .50), p95: percentile(samples, .95), p99: percentile(samples, .99) },
        cpuMilliseconds: (cpu.user + cpu.system) / 1000,
        heapDeltaBytes: process.memoryUsage().heapUsed - heapBefore,
    };
}

function measureSync(label, operation) {
    for (let index = 0; index < 500; index++) operation();
    global.gc?.();
    const heapBefore = process.memoryUsage().heapUsed;
    const cpuBefore = process.cpuUsage();
    const samples = [];
    const started = performance.now();
    for (let index = 0; index < iterations; index++) {
        const sampleStart = performance.now();
        operation();
        samples.push((performance.now() - sampleStart) * 1000);
    }
    const elapsedMs = performance.now() - started;
    const cpu = process.cpuUsage(cpuBefore);
    return finishMeasurement(label, samples, elapsedMs, cpu, heapBefore, "sync");
}

const rows = [];
const performanceResults = [
    measureSync("harness: no-op baseline", () => undefined),
    measureSync("harness: empty Uint8Array allocation", () => new Uint8Array(0)),
];
for (const scenario of scenarios) {
    const sonic = sonicFrame(scenario.packet, scenario.value);
    const json = jsonFrame(scenario.name, scenario.value);
    const payload = sonic.subarray(1);
    const compressed = Buffer.concat([Buffer.from([sonic[0]]), deflateRawSync(payload)]);
    const batch = Buffer.concat([Buffer.from([sonic[0]]), ...Array.from({ length: 10 }, () => Buffer.concat([varint(payload.length), payload]))]);
    rows.push({
        scenario: scenario.name,
        jsonBytes: json.length,
        sonicBytes: sonic.length,
        sonicDeflateBytes: compressed.length,
        sonicBatchTenBytes: batch.length,
        reductionPercent: 100 * (1 - sonic.length / json.length),
    });
    const input = [scenario.value];
    const prepared = scenario.packet.prepareSend(input, 0);
    const positional = scenario.packet.fields && !scenario.packet.autoFlatten
        ? scenario.packet.fields.map(field => scenario.value[field])
        : undefined;
    const mappingOnlyPacket = scenario.packet.quantized && scenario.packet.fields
        ? CreatePacket({
            tag: `${scenario.name}.mapping-only`,
            type: scenario.packet.type,
            schema: [...scenario.packet.fields],
            autoFlatten: scenario.packet.autoFlatten,
            noDataRange: scenario.packet.autoFlatten,
            dataMax: scenario.packet.autoFlatten ? undefined : scenario.packet.fields.length,
        })
        : undefined;
    const encodedPayloads = Array.from({ length: 10 }, () => payload);

    performanceResults.push(measureSync(`${scenario.name}: prepare object`, () => scenario.packet.prepareSend(input, 0)));
    if (mappingOnlyPacket)
        performanceResults.push(measureSync(`${scenario.name}: schema mapping only`, () => mappingOnlyPacket.prepareSend(input, 0)));
    if (positional) performanceResults.push(measureSync(`${scenario.name}: prepare positional`, () => scenario.packet.prepareSend(positional, 0)));
    performanceResults.push(measureSync(`${scenario.name}: process prepared (codec)`, () => scenario.packet.processSend(prepared)));
    if (scenario.packet.type === PacketType.VARINT)
        performanceResults.push(measureSync(`${scenario.name}: WASM VARINT reference`, () => nativeCore.encodeSigned(PacketType.VARINT, prepared)));
    performanceResults.push(measureSync(`${scenario.name}: full SonicWS`, () => sonicFrame(scenario.packet, scenario.value)));
    performanceResults.push(measureSync(`${scenario.name}: frame allocation + payload copy`, () => toPacketBuffer(1, payload)));
    performanceResults.push(measureSync(`${scenario.name}: JSON.stringify`, () => JSON.stringify({ event: scenario.name, data: scenario.value })));
    performanceResults.push(measureSync(`${scenario.name}: JSON stringify + byteLength`, () => Buffer.byteLength(JSON.stringify({ event: scenario.name, data: scenario.value }))));
    performanceResults.push(measureSync(`${scenario.name}: batch framing only (10)`, () => encodeNativeBatch(encodedPayloads, false)));
    performanceResults.push(measureSync(`${scenario.name}: WASM batch framing reference (10)`, () => nativeCore.encodeBatch(encodedPayloads, false)));
    performanceResults.push(measureSync(`${scenario.name}: encode + batch (10)`, () => {
        const encoded = [];
        for (let index = 0; index < 10; index++) encoded.push(scenario.packet.processSend(prepared));
        return encodeNativeBatch(encoded, false);
    }));
}

const report = {
    generatedAt: new Date().toISOString(),
    node: process.version,
    platform: `${process.platform}/${process.arch}`,
    iterations,
    note: "Stage-separated codec benchmark; sync and async measurements are intentionally identified. WebSocket framing and network latency are excluded.",
    sizes: rows,
    performance: performanceResults,
};

await mkdir(new URL("./results/", import.meta.url), { recursive: true });
await writeFile(new URL("./results/latest.json", import.meta.url), JSON.stringify(report, null, 2));
const markdown = [
    "# SonicWS reproducible benchmark",
    "",
    `Generated ${report.generatedAt} on ${report.node} (${report.platform}); ${iterations.toLocaleString()} iterations per encoder.`,
    "",
    "| Scenario | JSON bytes | SonicWS bytes | Raw-DEFLATE bytes | Batch of 10 bytes | Reduction vs JSON |",
    "|---|---:|---:|---:|---:|---:|",
    ...rows.map(row => `| ${row.scenario} | ${row.jsonBytes} | ${row.sonicBytes} | ${row.sonicDeflateBytes} | ${row.sonicBatchTenBytes} | ${row.reductionPercent.toFixed(1)}% |`),
    "",
    "| Stage | Mode | ops/s | p50 µs | p95 µs | p99 µs | heap delta |",
    "|---|---|---:|---:|---:|---:|---:|",
    ...performanceResults.map(result => `| ${result.label} | ${result.mode} | ${Math.round(result.operationsPerSecond).toLocaleString()} | ${result.latencyMicroseconds.p50.toFixed(2)} | ${result.latencyMicroseconds.p95.toFixed(2)} | ${result.latencyMicroseconds.p99.toFixed(2)} | ${result.heapDeltaBytes.toLocaleString()} |`),
    "",
    "This is a codec benchmark, not a claim about end-to-end Socket.IO or uWebSockets.js throughput. Install and run their dedicated adapters before publishing cross-library numbers.",
    "",
];
await writeFile(new URL("./results/latest.md", import.meta.url), markdown.join("\n"));
console.table(rows);
console.table(performanceResults.map(result => ({
    benchmark: result.label,
    mode: result.mode,
    "ops/s": Math.round(result.operationsPerSecond),
    "p50 µs": result.latencyMicroseconds.p50.toFixed(2),
    "p95 µs": result.latencyMicroseconds.p95.toFixed(2),
    "p99 µs": result.latencyMicroseconds.p99.toFixed(2),
    "CPU ms": result.cpuMilliseconds.toFixed(1),
})));
console.log("Wrote benchmarks/results/latest.json and latest.md");
