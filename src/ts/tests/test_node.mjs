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
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.env.SONIC_WS_CORE_PATH ??= path.join(root, "src/core/tests/typescript/sonic_ws_core.node");

const {
    SonicWS,
    SonicWSServer,
    PacketType,
    CreatePacket,
    CreateObjPacket,
    CreateEnumPacket,
    DefineEnum,
    WrapEnum,
} = await import("../../../dist/ts/index.js");

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
];

function makePackets(prefix) {
    return cases.map(testCase => testCase.create(`${prefix}_${testCase.name}`));
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

try {
    server = new SonicWSServer({
        clientPackets: makePackets("client"),
        serverPackets: makePackets("server"),
        websocketOptions: { port: 0, host: "127.0.0.1" },
        sonicServerSettings: { checkForUpdates: false },
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
    const clientRawSends = [];
    const serverRawSends = [];
    client.raw_onsend(data => clientRawSends.push(Uint8Array.from(data)));
    connection.raw_onsend(data => serverRawSends.push(Uint8Array.from(data)));
    const serverReceives = cases.map(testCase => expectPacket(
        (tag, listener) => connection.on(tag, listener),
        `client_${testCase.name}`,
        testCase.expected,
    ));

    for (const testCase of cases) await client.send(`client_${testCase.name}`, ...testCase.send);
    for (const testCase of cases) await connection.send(`server_${testCase.name}`, ...testCase.send);

    await withTimeout(Promise.all([...clientReceives, ...serverReceives]), 10_000, "packet roundtrips");
    assert(clientRawSends.length >= cases.length, "client raw_onsend did not observe sends");
    assert(serverRawSends.length >= cases.length, "server raw_onsend did not observe sends");
    assert.equal(CreatePacket({ tag: "rate16", rateLimit: 65_535 }).rateLimit, 65_535);
    console.log(`passed ${cases.length * 2} packet roundtrips across ${cases.length} packet definitions`);
    console.log("KEY_EFFECTIVE is intentionally excluded because it remains W.I.P.");
} finally {
    if (client && !client.isClosed()) {
        const closed = new Promise(resolve => client.on_close(resolve));
        client.close();
        await withTimeout(closed, 2_000, "client close").catch(() => undefined);
    }
    if (server) await new Promise(resolve => server.shutdown(() => resolve()));
}
