/*
 * Copyright (c) 2026 Lily (liwybloc)
 *
 * Licensed for personal, non-commercial use only.
 * Commercial use, redistribution, sublicensing, sale, rental, lease,
 * or inclusion in a paid product or service is prohibited without prior
 * written permission from the copyright holder.
 *
 * See the LICENSE file in the project root for the full license terms.
 *
 * License-Identifier: LicenseRef-Lily-Personal-NonCommercial-2026
 */

import assert from "node:assert/strict";
const {
    SonicWS,
    SonicWSServer,
    PacketType,
    CreatePacket,
    CreateObjPacket,
    CreateEnumPacket,
    CreatePacketGroup,
    DefineEnum,
    WrapEnum,
    RegisterPacketConstructor,
    CreatePacketManifest,
    LoadPacketManifest,
} = await import("../dist/index.js");

class C2SMovement {
    constructor({ x, y, z }) { this.x = x; this.y = y; this.z = z; }
}
RegisterPacketConstructor(C2SMovement);

const mixedEnum = DefineEnum("e2e-mixed", ["alpha", 7, true, null, undefined]);
const objectEnum = DefineEnum("e2e-object", ["left", "right"]);

const cases = [
    { name: "none", create: tag => CreatePacket({ tag, type: PacketType.NONE, dataMin: 0, dataMax: 0 }), send: [], expected: [undefined] },
    { name: "raw", create: tag => CreatePacket({ tag, type: PacketType.RAW, dataMin: 4, dataMax: 4 }), send: [0, 1, 128, 255], expected: [Uint8Array.from([0, 1, 128, 255])] },
    { name: "ascii", create: tag => CreatePacket({ tag, type: PacketType.STRINGS_ASCII, dataMin: 3, dataMax: 3 }), send: ["hello world", "SonicWS", ""], expected: ["hello world", "SonicWS", ""] },
    { name: "utf16", create: tag => CreatePacket({ tag, type: PacketType.STRINGS_UTF16, dataMin: 4, dataMax: 4 }), send: ["another😂", "𐍈", "𝄞", "🧪"], expected: ["another😂", "𐍈", "𝄞", "🧪"] },
    { name: "enums", create: tag => CreateEnumPacket({ tag, enumData: mixedEnum, dataMin: 5, dataMax: 5 }), send: mixedEnum.values.map(value => WrapEnum(mixedEnum.tag, value)), expected: [...mixedEnum.values] },
    { name: "bytes", create: tag => CreatePacket({ tag, type: PacketType.BYTES, dataMin: 5, dataMax: 5 }), send: [-128, -1, 0, 1, 127], expected: [-128, -1, 0, 1, 127] },
    { name: "ubytes", create: tag => CreatePacket({ tag, type: PacketType.UBYTES, dataMin: 4, dataMax: 4 }), send: [0, 1, 254, 255], expected: [0, 1, 254, 255] },
    { name: "shorts", create: tag => CreatePacket({ tag, type: PacketType.SHORTS, dataMin: 5, dataMax: 5 }), send: [-32768, -1, 0, 1, 32767], expected: [-32768, -1, 0, 1, 32767] },
    { name: "ushorts", create: tag => CreatePacket({ tag, type: PacketType.USHORTS, dataMin: 4, dataMax: 4 }), send: [0, 1, 65534, 65535], expected: [0, 1, 65534, 65535] },
    { name: "varint", create: tag => CreatePacket({ tag, type: PacketType.VARINT, dataMin: 5, dataMax: 5 }), send: [-2147483648, -1, 0, 1, 2147483647], expected: [-2147483648, -1, 0, 1, 2147483647] },
    { name: "uvarint", create: tag => CreatePacket({ tag, type: PacketType.UVARINT, dataMin: 7, dataMax: 7 }), send: [0, 1, 127, 128, 255, 16384, 4294967295], expected: [0, 1, 127, 128, 255, 16384, 4294967295] },
    { name: "deltas", create: tag => CreatePacket({ tag, type: PacketType.DELTAS, dataMin: 8, dataMax: 8 }), send: [-50, -25, 1, 2, 1000, 1004, 1004, -5], expected: [-50, -25, 1, 2, 1000, 1004, 1004, -5] },
    { name: "floats", create: tag => CreatePacket({ tag, type: PacketType.FLOATS, dataMin: 5, dataMax: 5 }), send: [0, 1.5, -1.5, 958412.128498, 1e-10], expected: [0, 1.5, -1.5, Math.fround(958412.128498), Math.fround(1e-10)] },
    { name: "doubles", create: tag => CreatePacket({ tag, type: PacketType.DOUBLES, dataMin: 5, dataMax: 5 }), send: [0, 1.5, -1.5, 958412.128498, Infinity], expected: [0, 1.5, -1.5, 958412.1284979999, Infinity] },
    { name: "booleans", create: tag => CreatePacket({ tag, type: PacketType.BOOLEANS, dataMin: 9, dataMax: 9 }), send: [true, false, true, false, true, false, true, false, true], expected: [true, false, true, false, true, false, true, false, true] },
    { name: "json", create: tag => CreatePacket({ tag, type: PacketType.JSON, dataMin: 1, dataMax: 1 }), send: [{ ok: true, nested: [1, "two", false, null] }], expected: [{ ok: true, nested: [1, "two", false, null] }] },
    { name: "hex", create: tag => CreatePacket({ tag, type: PacketType.HEX, dataMin: 1, dataMax: 3 }), send: ["00abff"], expected: ["00abff"] },
    {
        name: "object",
        create: tag => CreateObjPacket({
            tag,
            types: [PacketType.STRINGS_ASCII, PacketType.BOOLEANS, PacketType.BYTES, objectEnum, PacketType.JSON],
            dataMins: [2, 3, 3, 2, 1],
            dataMaxes: [2, 3, 3, 2, 1],
            gzipCompression: false,
        }),
        send: [["hello", "world"], [true, false, true], [-1, 0, 1], [WrapEnum(objectEnum.tag, "right"), WrapEnum(objectEnum.tag, "left")], [{ json: true }]],
        expected: [["hello", "world"], [true, false, true], [-1, 0, 1], ["right", "left"], [{ json: true }]],
    },
    {
        name: "batch",
        create: tag => CreatePacket({ tag, type: PacketType.UVARINT, dataMin: 3, dataMax: 3, dataBatching: 10, maxBatchSize: 4, gzipCompression: true }),
        send: [7, 128, 16384],
        expected: [7, 128, 16384],
    },
    {
        name: "schema",
        create: tag => CreatePacket({ tag, type: PacketType.VARINT, schema: ["dx", "dy", "dz"], dataMin: 3, dataMax: 3 }),
        send: [{ dx: 1, dy: 2, dz: 3 }],
        expected: [{ dx: 1, dy: 2, dz: 3 }],
    },
    {
        name: "flatten",
        create: tag => CreatePacket({ tag, type: PacketType.VARINT, schema: ["id", "x"], autoFlatten: true }),
        send: [[{ id: 1, x: 10 }, { id: 2, x: 20 }]],
        expected: [[{ id: 1, x: 10 }, { id: 2, x: 20 }]],
    },
    {
        name: "transpose",
        create: tag => CreateObjPacket({ tag, types: [PacketType.VARINT, PacketType.STRINGS_ASCII], schema: ["x", "label"], autoTranspose: true, noDataRange: true }),
        send: [[{ x: 1, label: "one" }, { x: 2, label: "two" }]],
        expected: [[{ x: 1, label: "one" }, { x: 2, label: "two" }]],
    },
    {
        name: "quantized",
        create: tag => CreatePacket({ tag, type: PacketType.SHORTS, schema: ["dx", "dy", "dz"], dataMin: 3, dataMax: 3, quantized: { scale: 100 }, min: -1, max: 1 }),
        send: [{ dx: .5, dy: 0, dz: -.5 }],
        expected: [{ dx: .5, dy: 0, dz: -.5 }],
    },
    {
        name: "constructed",
        create: tag => CreatePacket({ tag, type: PacketType.VARINT, schema: ["x", "y", "z"], dataMax: 3, constructor: C2SMovement }),
        send: [new C2SMovement({ x: 3, y: 4, z: 5 })],
        expected: [new C2SMovement({ x: 3, y: 4, z: 5 })],
    },
];

function makePackets(prefix) {
    return [
        ...cases.map(testCase => testCase.create(`${prefix}_${testCase.name}`)),
        ...CreatePacketGroup({ tag: `${prefix}_movement`, variants: {
            move: { type: PacketType.VARINT, schema: ["dx", "dy", "dz"], dataMin: 3, dataMax: 3 },
        } }),
    ];
}

function normalize(value) {
    if (value instanceof Uint8Array) return [...value];
    if (Array.isArray(value)) return value.map(normalize);
    if (value && typeof value === "object")
        return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, normalize(nested)]));
    return value;
}

function expectPacket(register, tag, expected) {
    return new Promise((resolve, reject) => {
        register(tag, (...received) => {
            try {
                assert.deepStrictEqual(normalize(received), normalize(expected), tag);
                console.log(`ok - ${tag}`);
                resolve();
            } catch (error) {
                reject(error);
            }
        });
    });
}

function withTimeout(promise, milliseconds, label) {
    return Promise.race([
        promise,
        new Promise((_, reject) => setTimeout(() => reject(new Error(`Timed out: ${label}`)), milliseconds)),
    ]);
}

let server;
let client;
const sendErrors = [];
const adapterEvents = [];
const adapter = {
    start(serverId, receiver) { this.serverId = serverId; this.receiver = receiver; },
    publish(message) { adapterEvents.push(["publish", message]); },
    join(id, room) { adapterEvents.push(["join", id, room]); },
    leave(id, room) { adapterEvents.push(["leave", id, room]); },
    disconnect(id) { adapterEvents.push(["disconnect", id]); },
};

try {
    server = new SonicWSServer({
        clientPackets: makePackets("client"),
        serverPackets: makePackets("server"),
        websocketOptions: { port: 0, host: "127.0.0.1" },
        sonicServerSettings: { checkForUpdates: false },
        onSendError: (error, context) => sendErrors.push({ error, context }),
        adapter,
    });

    await withTimeout(new Promise(resolve => server.on_ready(resolve)), 5_000, "server listen");
    const address = server.wss.address();
    assert(address && typeof address !== "string");

    const connectionPromise = new Promise(resolve => server.on_connect(resolve));
    client = new SonicWS(`ws://127.0.0.1:${address.port}`);

    const clientReceives = cases.map(testCase => expectPacket(
        (tag, listener) => client.on(tag, listener),
        `server_${testCase.name}`,
        testCase.expected,
    ));

    await withTimeout(Promise.all([
        connectionPromise,
        new Promise(resolve => client.on_ready(resolve)),
    ]), 5_000, "client handshake");

    const connection = await connectionPromise;
    connection.state.player = { id: 7 };
    assert.deepEqual(connection.state.player, { id: 7 });
    connection.respond("client_schema", ({ dx, dy, dz }) => ({ sum: dx + dy + dz }));
    client.respond("server_schema", ({ dx, dy, dz }) => ({ sum: dx + dy + dz }));
    assert.deepEqual(await client.request("client_schema", { dx: 2, dy: 3, dz: 4 }), { sum: 9 });
    assert.deepEqual(await connection.request("server_schema", { dx: 4, dy: 5, dz: 6 }), { sum: 15 });
    connection.join("world:one");
    assert(connection.getRooms().has("world:one"));
    assert(adapterEvents.some(event => event[0] === "join" && event[2] === "world:one"));
    const clientRawSends = [];
    const serverRawSends = [];
    client.raw_onsend(data => clientRawSends.push(Uint8Array.from(data)));
    connection.raw_onsend(data => serverRawSends.push(Uint8Array.from(data)));
    const serverReceives = cases.map(testCase => expectPacket(
        (tag, listener) => connection.on(tag, listener),
        `client_${testCase.name}`,
        testCase.expected,
    ));
    const serverParent = new Promise(resolve => connection.on("client_movement", value => {
        assert.deepEqual(value, { variant: "move", payload: { dx: 8, dy: 9, dz: 10 } }); resolve();
    }));
    const clientParent = new Promise(resolve => client.on("server_movement", value => {
        assert.deepEqual(value, { variant: "move", payload: { dx: 5, dy: 6, dz: 7 } }); resolve();
    }));
    const childReceive = new Promise(resolve => client.on("server_movement.move", value => {
        assert.deepEqual(value, { dx: 5, dy: 6, dz: 7 }); resolve();
    }));

    for (const testCase of cases) await client.send(`client_${testCase.name}`, ...testCase.send);
    for (const testCase of cases) await connection.send(`server_${testCase.name}`, ...testCase.send);
    await client.sendVariant("client_movement", "move", { dx: 8, dy: 9, dz: 10 });
    await connection.sendVariant("server_movement", "move", { dx: 5, dy: 6, dz: 7 });

    await withTimeout(Promise.all([...clientReceives, ...serverReceives, serverParent, clientParent, childReceive]), 10_000, "packet roundtrips");
    const roomReceive = new Promise(resolve => client.on("server_schema", value => {
        if (value.dx === 11) resolve();
    }));
    await server.broadcastRoom("world:one", "server_schema", { dx: 11, dy: 12, dz: 13 });
    await withTimeout(roomReceive, 2_000, "room broadcast");
    assert(adapterEvents.some(event => event[0] === "publish" && event[1].room === "world:one"));
    assert(clientRawSends.length >= cases.length, "client raw_onsend did not observe sends");
    assert(serverRawSends.length >= cases.length, "server raw_onsend did not observe sends");
    assert.equal(CreatePacket({ tag: "rate16", rateLimit: 65_535 }).rateLimit, 65_535);
    const mapped = CreatePacket({ tag: "mapped", type: PacketType.VARINT, schema: ["x", "y"], dataMin: 2, dataMax: 2 });
    assert.deepEqual([...await mapped.processSend(mapped.prepareSend([{ x: 4, y: 5 }]))], [...await mapped.processSend([4, 5])]);
    assert.throws(() => mapped.prepareSend([{ x: 1 }]), /missing schema field/i);
    assert.throws(() => mapped.prepareSend([{ x: 1, y: 2, z: 3 }]), /unknown schema field/i);
    const repeated = CreatePacket({ tag: "repeated", type: PacketType.VARINT, schema: ["x", "y"], autoFlatten: true });
    assert.throws(() => repeated.finishReceive([1, 2, 3]), /not divisible/i);
    const bounded = CreatePacket({ tag: "bounded", type: PacketType.VARINT, min: -2, max: 2 });
    assert.throws(() => bounded.prepareSend([3]), /exceeds maximum/i);
    assert.throws(() => bounded.finishReceive([3]), /exceeds maximum/i);
    const quantized = CreatePacket({ tag: "wire-q", type: PacketType.SHORTS, quantized: { scale: 100 }, min: -1, max: 1 });
    assert.deepEqual(quantized.prepareSend([.5, -.5]), [50, -50]);
    const feedback = CreatePacket({ tag: "feedback", type: PacketType.VARINT, quantized: { scale: 1024 } });
    assert.equal(feedback.quantized.trackError, true);
    assert.equal(feedback.prepareSend([1.5283], 1)[0], 1565);
    assert.equal(feedback.prepareSend([1.5283], 2)[0], 1565, "quantization error leaked between connections");
    let wireSum = 1565;
    for (let index = 1; index < 1000; index++) wireSum += feedback.prepareSend([1.5283], 1)[0];
    assert(Math.abs(wireSum / 1024 - 1528.3) <= .5 / 1024, "error feedback did not preserve the cumulative value");
    const stateless = CreatePacket({ tag: "stateless-q", type: PacketType.VARINT, quantized: { scale: 1024, trackError: false } });
    assert.deepEqual([stateless.prepareSend([1.5283])[0], stateless.prepareSend([1.5283])[0]], [1565, 1565]);
    const group = CreatePacketGroup({ tag: "movement", variants: { still: { type: PacketType.NONE }, move: { type: PacketType.VARINT, schema: ["dx", "dy", "dz"], dataMin: 3, dataMax: 3 } } });
    assert.deepEqual(group.map(packet => packet.tag), ["movement", "movement.still", "movement.move"]);
    assert.equal(group[0].type, PacketType.NONE);
    assert.equal(group[0].variant, "");
    assert.deepEqual(await group[0].listen(new Uint8Array(), null), [{ variant: "", payload: undefined }, false]);
    const constructedPacket = CreatePacket({ tag: "constructed-unit", type: PacketType.VARINT, schema: ["x", "y", "z"], dataMax: 3, constructor: C2SMovement });
    assert.equal(constructedPacket.constructorName, "C2SMovement");
    assert(constructedPacket.finishReceive([1, 2, 3]) instanceof C2SMovement);
    const replayedPacket = CreatePacket({ tag: "replayed", type: PacketType.VARINT, replay: true });
    assert.equal(replayedPacket.replay, true);
    assert(Buffer.from(replayedPacket.serialize()).includes(Buffer.from('"replay":true')));
    assert.throws(() => CreatePacket({ tag: "invalid-replay", replay: true, dataBatching: 1 }), /replay.*batching/i);
    const manifest = LoadPacketManifest(CreatePacketManifest({ clientPackets: [mapped], serverPackets: [replayedPacket] }));
    assert.deepEqual(manifest.clientPackets.map(value => value.tag), ["mapped"]);
    assert.deepEqual(manifest.serverPackets.map(value => value.tag), ["replayed"]);
    assert.equal(await connection.sendSafe("not-a-packet"), false);
    assert.equal(await server.broadcastSafe("not-a-packet"), false);
    assert.equal(sendErrors.length, 2);
    assert.equal(sendErrors[0].context.packetTag, "not-a-packet");
    console.log(`passed ${cases.length * 2} packet roundtrips across ${cases.length} packet definitions`);
} finally {
    if (client && !client.isClosed()) {
        const closed = new Promise(resolve => client.on_close(resolve));
        client.close();
        await withTimeout(closed, 2_000, "client close").catch(() => undefined);
    }
    if (server) await new Promise(resolve => server.shutdown(() => resolve()));
}

await import("./test_recovery.mjs");
