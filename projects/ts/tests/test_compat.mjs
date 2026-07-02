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

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

process.env.SONIC_WS_CORE_PATH ??= path.join(
    repository,
    "projects/core/tests/typescript/sonic_ws_core.node",
);

const {
    SonicWS,
    SonicWSServer,
    PacketType,
    CreatePacket,
    CreateObjPacket,
    CreateEnumPacket,
    DefineEnum,
    WrapEnum,
} = await import(path.join(project, "dist/index.js"));

const HOST = "127.0.0.1";
const PORT = 8963;

const mixedEnum = DefineEnum("compat-mixed", [
    "alpha",
    7,
    true,
    null,
]);

const objectEnum = DefineEnum("compat-object", ["left", "right"]);

const cases = [
    {
        name: "none",
        create: tag =>
            CreatePacket({
                tag,
                type: PacketType.NONE,
                dataMin: 0,
                dataMax: 0,
            }),
        send: [],
        expected: [undefined],
    },
    {
        name: "raw",
        create: tag =>
            CreatePacket({
                tag,
                type: PacketType.RAW,
                dataMin: 4,
                dataMax: 4,
            }),
        send: [0, 1, 128, 255],
        expected: [Uint8Array.from([0, 1, 128, 255])],
    },
    {
        name: "ascii",
        create: tag =>
            CreatePacket({
                tag,
                type: PacketType.STRINGS_ASCII,
                dataMin: 3,
                dataMax: 3,
            }),
        send: ["hello world", "SonicWS", ""],
        expected: ["hello world", "SonicWS", ""],
    },
    {
        name: "utf16",
        create: tag =>
            CreatePacket({
                tag,
                type: PacketType.STRINGS_UTF16,
                dataMin: 4,
                dataMax: 4,
            }),
        send: ["another😂", "𐍈", "𝄞", "🧪"],
        expected: ["another😂", "𐍈", "𝄞", "🧪"],
    },
    {
        name: "enums",
        create: tag =>
            CreateEnumPacket({
                tag,
                enumData: mixedEnum,
                dataMin: 4,
                dataMax: 4,
            }),
        send: mixedEnum.values.map(value => WrapEnum(mixedEnum.tag, value)),
        expected: [...mixedEnum.values],
    },
    {
        name: "bytes",
        create: tag =>
            CreatePacket({
                tag,
                type: PacketType.BYTES,
                dataMin: 5,
                dataMax: 5,
            }),
        send: [-128, -1, 0, 1, 127],
        expected: [-128, -1, 0, 1, 127],
    },
    {
        name: "ubytes",
        create: tag =>
            CreatePacket({
                tag,
                type: PacketType.UBYTES,
                dataMin: 4,
                dataMax: 4,
            }),
        send: [0, 1, 254, 255],
        expected: [0, 1, 254, 255],
    },
    {
        name: "shorts",
        create: tag =>
            CreatePacket({
                tag,
                type: PacketType.SHORTS,
                dataMin: 5,
                dataMax: 5,
            }),
        send: [-32768, -1, 0, 1, 32767],
        expected: [-32768, -1, 0, 1, 32767],
    },
    {
        name: "ushorts",
        create: tag =>
            CreatePacket({
                tag,
                type: PacketType.USHORTS,
                dataMin: 4,
                dataMax: 4,
            }),
        send: [0, 1, 65534, 65535],
        expected: [0, 1, 65534, 65535],
    },
    {
        name: "varint",
        create: tag =>
            CreatePacket({
                tag,
                type: PacketType.VARINT,
                dataMin: 5,
                dataMax: 5,
            }),
        send: [-2147483648, -1, 0, 1, 2147483647],
        expected: [-2147483648, -1, 0, 1, 2147483647],
    },
    {
        name: "uvarint",
        create: tag =>
            CreatePacket({
                tag,
                type: PacketType.UVARINT,
                dataMin: 7,
                dataMax: 7,
            }),
        send: [0, 1, 127, 128, 255, 16384, 4294967295],
        expected: [0, 1, 127, 128, 255, 16384, 4294967295],
    },
    {
        name: "deltas",
        create: tag =>
            CreatePacket({
                tag,
                type: PacketType.DELTAS,
                dataMin: 8,
                dataMax: 8,
            }),
        send: [-50, -25, 1, 2, 1000, 1004, 1004, -5],
        expected: [-50, -25, 1, 2, 1000, 1004, 1004, -5],
    },
    {
        name: "floats",
        create: tag =>
            CreatePacket({
                tag,
                type: PacketType.FLOATS,
                dataMin: 5,
                dataMax: 5,
            }),
        send: [0, 1.5, -1.5, 958412.128498, 1e-10],
        expected: [0, 1.5, -1.5, Math.fround(958412.128498), Math.fround(1e-10)],
    },
    {
        name: "doubles",
        create: tag =>
            CreatePacket({
                tag,
                type: PacketType.DOUBLES,
                dataMin: 5,
                dataMax: 5,
            }),
        send: [0, 1.5, -1.5, 958412.128498, Infinity],
        expected: [0, 1.5, -1.5, 958412.1284979999, Infinity],
    },
    {
        name: "booleans",
        create: tag =>
            CreatePacket({
                tag,
                type: PacketType.BOOLEANS,
                dataMin: 9,
                dataMax: 9,
            }),
        send: [true, false, true, false, true, false, true, false, true],
        expected: [true, false, true, false, true, false, true, false, true],
    },
    {
        name: "json",
        create: tag =>
            CreatePacket({
                tag,
                type: PacketType.JSON,
                dataMin: 1,
                dataMax: 1,
            }),
        send: [{ ok: true, nested: [1, "two", false, null] }],
        expected: [{ ok: true, nested: [1, "two", false, null] }],
    },
    {
        name: "hex",
        create: tag =>
            CreatePacket({
                tag,
                type: PacketType.HEX,
                dataMin: 1,
                dataMax: 3,
            }),
        send: ["00abff"],
        expected: ["00abff"],
    },
    {
        name: "object",
        create: tag =>
            CreateObjPacket({
                tag,
                types: [
                    PacketType.STRINGS_ASCII,
                    PacketType.BOOLEANS,
                    PacketType.BYTES,
                    objectEnum,
                    PacketType.JSON,
                ],
                dataMins: [2, 3, 3, 2, 1],
                dataMaxes: [2, 3, 3, 2, 1],
                gzipCompression: false,
            }),
        send: [
            ["hello", "world"],
            [true, false, true],
            [-1, 0, 1],
            [
                WrapEnum(objectEnum.tag, "right"),
                WrapEnum(objectEnum.tag, "left"),
            ],
            [{ json: true }],
        ],
        expected: [
            ["hello", "world"],
            [true, false, true],
            [-1, 0, 1],
            ["right", "left"],
            [{ json: true }],
        ],
    },
    {
        name: "batch",
        create: tag =>
            CreatePacket({
                tag,
                type: PacketType.UVARINT,
                dataMin: 3,
                dataMax: 3,
                dataBatching: 10,
                maxBatchSize: 4,
                gzipCompression: true,
            }),
        send: [7, 128, 16384],
        expected: [7, 128, 16384],
    },
];

function usage() {
    console.error("usage:");
    console.error("  node test_compat.mjs --host");
    console.error("  node test_compat.mjs --server");
    console.error("");
    console.error("--host   starts a SonicWS server on port 8963");
    console.error("--server connects to ws://127.0.0.1:8963");
    console.error("--client is accepted as an alias for --server");
}

function parseMode() {
    const hasHost = process.argv.includes("--host");
    const hasServer = process.argv.includes("--server");
    const hasClient = process.argv.includes("--client");

    const connectMode = hasServer || hasClient;
    const count = Number(hasHost) + Number(connectMode);

    if (count !== 1) {
        usage();
        process.exit(2);
    }

    return hasHost ? "host" : "server";
}

function makePackets(prefix) {
    return cases.map(testCase => testCase.create(`${prefix}_${testCase.name}`));
}

function normalize(value) {
    if (value instanceof Uint8Array) {
        return [...value];
    }

    if (Array.isArray(value)) {
        return value.map(normalize);
    }

    if (value && typeof value === "object") {
        return Object.fromEntries(
            Object.entries(value).map(([key, nested]) => [key, normalize(nested)]),
        );
    }

    return value;
}

function withTimeout(promise, milliseconds, label) {
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(
            () => reject(new Error(`Timed out after ${milliseconds}ms: ${label}`)),
            milliseconds,
        );

        Promise.resolve(promise).then(
            value => {
                clearTimeout(timeout);
                resolve(value);
            },
            error => {
                clearTimeout(timeout);
                reject(error);
            },
        );
    });
}

function waitForReady(endpoint, label) {
    return withTimeout(
        new Promise(resolve => endpoint.on_ready(resolve)),
        5_000,
        label,
    );
}

function waitForClose(endpoint, label) {
    return withTimeout(
        new Promise(resolve => endpoint.on_close(resolve)),
        2_000,
        label,
    ).catch(() => undefined);
}

function registerPacketExpectations(owner, register, prefix) {
    return cases.map(testCase => {
        const tag = `${prefix}_${testCase.name}`;

        return new Promise((resolve, reject) => {
            register(tag, (...received) => {
                try {
                    assert.deepStrictEqual(
                        normalize(received),
                        normalize(testCase.expected),
                        tag,
                    );

                    console.log(`ok - ${owner} received ${tag}`);
                    resolve();
                } catch (error) {
                    reject(error);
                }
            });
        });
    });
}

async function sendAll(owner, endpoint, prefix) {
    for (const testCase of cases) {
        const tag = `${prefix}_${testCase.name}`;

        console.log(`${owner} sending ${tag}: ${testCase.send}`);
        await endpoint.send(tag, ...testCase.send);
    }

    // Batched packets flush asynchronously after their configured interval.
    await new Promise(resolve => setTimeout(resolve, 100));
}

async function runHost() {
    let server;

    try {
        server = new SonicWSServer({
            clientPackets: makePackets("client"),
            serverPackets: makePackets("server"),
            websocketOptions: {
                port: PORT,
                host: HOST,
            },
            sonicServerSettings: {
                checkForUpdates: false,
            },
        });

        await waitForReady(server, "server listen");

        console.log(`host listening on ws://${HOST}:${PORT}`);
        console.log("waiting for client...");

        const { connection, hostReceives } = await withTimeout(
            new Promise(resolve => server.on_connect(connection => resolve({
                connection,
                hostReceives: registerPacketExpectations(
                    "host",
                    (tag, listener) => connection.on(tag, listener),
                    "client",
                ),
            }))),
            60_000,
            "client connection",
        );

        console.log("client connected");

        await new Promise(resolve => setTimeout(resolve, 250));
        await sendAll("host", connection, "server");

        await withTimeout(
            Promise.all(hostReceives),
            15_000,
            "host receive all client packets",
        );

        console.log(`host passed ${cases.length} received packet checks`);
    } finally {
        if (server) {
            await new Promise(resolve => server.shutdown(() => resolve()));
            console.log("host shut down");
        }
    }
}

async function runServerConnector() {
    let client;

    try {
        const url = `ws://${HOST}:${PORT}`;

        console.log(`connecting to ${url}`);

        client = new SonicWS(url);

        const clientReceives = registerPacketExpectations(
            "connector",
            (tag, listener) => client.on(tag, listener),
            "server",
        );

        await waitForReady(client, "client handshake");

        console.log("connected");

        await sendAll("connector", client, "client");

        await withTimeout(
            Promise.all(clientReceives),
            15_000,
            "connector receive all server packets",
        );

        console.log(`connector passed ${cases.length} received packet checks`);
    } finally {
        if (client && !client.isClosed()) {
            const closed = waitForClose(client, "client close");
            client.close();
            await closed;
        }

        console.log("connector closed");
    }
}

const mode = parseMode();

process.on("SIGINT", () => {
    console.log("\nreceived Ctrl+C");
    process.exit(0);
});

if (mode === "host") {
    await runHost();
} else {
    await runServerConnector();
}
