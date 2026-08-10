import assert from "node:assert/strict";

import {
    SonicWS,
    SonicWSServer,
    PacketType,
    CreatePacket,
} from "sonic-ws";

import { RedisAdapter } from "../dist/index.js";

const REDIS_URL =
    process.env.REDIS_URL ?? "redis://127.0.0.1:6379";

const CHANNEL =
    `sonic-ws:test:${process.pid}:${Date.now()}`;

const ROOM = "room-x";
const OTHER_ROOM = "room-y";

const PORT_A = 18081;
const PORT_B = 18082;


// Packet definitions

const clientPackets = [];

const serverPackets = [
    CreatePacket({
        tag: "message",
        type: PacketType.STRINGS_UTF16,
        dataMax: 1,
    }),
];


// Helpers

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitUntil(
    predicate,
    message,
    timeoutMs = 2000
) {
    const started = Date.now();

    while (Date.now() - started < timeoutMs) {
        if (predicate()) {
            return;
        }

        await sleep(10);
    }

    throw new Error(
        `Timed out waiting for: ${message}`
    );
}

async function expectNoNewMessages(
    clients,
    action,
    waitMs = 250
) {
    const before = new Map(
        clients.map(client => [
            client,
            client.messages.length,
        ])
    );

    await action();
    await sleep(waitMs);

    for (const client of clients) {
        assert.equal(
            client.messages.length,
            before.get(client),
            `${client.name} unexpectedly received a message`
        );
    }
}

function attachRecorder(name, socket) {
    const record = {
        name,
        socket,
        messages: [],
    };

    socket.on("message", value => {
        console.log(
            `  ${name} received:`,
            value
        );

        record.messages.push(value);
    });

    return record;
}

function clearMessages(...clients) {
    for (const client of clients) {
        client.messages.length = 0;
    }
}

async function closeServer(server) {
    await new Promise(resolve => {
        server.shutdown(resolve);
    });
}


// Test time

let serverA;
let serverB;

let clientA1;
let clientA2;
let clientB1;
let clientB2;

try {
    console.log("");
    console.log("Starting SonicWS Redis integration test...");
    console.log(`Redis:   ${REDIS_URL}`);
    console.log(`Channel: ${CHANNEL}`);
    console.log("");


    // tests with 2 servers

    serverA = new SonicWSServer({
        clientPackets,
        serverPackets,

        adapter: new RedisAdapter({
            url: REDIS_URL,
            channel: CHANNEL,
        }),

        websocketOptions: {
            port: PORT_A,
        },

        sonicServerSettings: {
            checkForUpdates: false,
            heartbeat: false,
        },
    });

    serverB = new SonicWSServer({
        clientPackets,
        serverPackets,

        adapter: new RedisAdapter({
            url: REDIS_URL,
            channel: CHANNEL,
        }),

        websocketOptions: {
            port: PORT_B,
        },

        sonicServerSettings: {
            checkForUpdates: false,
            heartbeat: false,
        },
    });


    // capture server-side connections

    const connectionsA = [];
    const connectionsB = [];

    serverA.on_connect(connection => {
        connectionsA.push(connection);
    });

    serverB.on_connect(connection => {
        connectionsB.push(connection);
    });


    // Server A:
    //   A1 -> ROOM
    //   A2 -> ROOM
    //
    // Server B:
    //   B1 -> ROOM
    //   B2 -> OTHER_ROOM

    const socketA1 = await SonicWS.connect(
        `ws://127.0.0.1:${PORT_A}`
    );

    const socketA2 = await SonicWS.connect(
        `ws://127.0.0.1:${PORT_A}`
    );

    const socketB1 = await SonicWS.connect(
        `ws://127.0.0.1:${PORT_B}`
    );

    const socketB2 = await SonicWS.connect(
        `ws://127.0.0.1:${PORT_B}`
    );

    clientA1 = attachRecorder("A1", socketA1);
    clientA2 = attachRecorder("A2", socketA2);
    clientB1 = attachRecorder("B1", socketB1);
    clientB2 = attachRecorder("B2", socketB2);


    await waitUntil(
        () =>
            connectionsA.length === 2 &&
            connectionsB.length === 2,
        "all server-side connections"
    );

    const [
        connectionA1,
        connectionA2,
    ] = connectionsA;

    const [
        connectionB1,
        connectionB2,
    ] = connectionsB;


    console.log("Connection IDs:");
    console.log(`  A1 = ${connectionA1.id}`);
    console.log(`  A2 = ${connectionA2.id}`);
    console.log(`  B1 = ${connectionB1.id}`);
    console.log(`  B2 = ${connectionB2.id}`);
    console.log("");


    // A1 and B1 should normally have the same ID because they are each the
    // first connection on their respective SonicWS server
    //
    // this reproduces the old exceptConnectionId bug

    assert.equal(
        connectionA1.id,
        connectionB1.id,
        [
            "Expected A1 and B1 to have the same connection ID.",
            "The collision test depends on two different servers",
            "having an identical local connection ID.",
        ].join(" ")
    );

    console.log(
        "✓ connection ID collision reproduced:",
        connectionA1.id
    );


    // Join rooms

    serverA.join(
        connectionA1,
        ROOM
    );

    serverA.join(
        connectionA2,
        ROOM
    );

    serverB.join(
        connectionB1,
        ROOM
    );

    serverB.join(
        connectionB2,
        OTHER_ROOM
    );

    console.log("✓ clients joined rooms");

    // Give any adapter-side hooks a moment to finish.
    await sleep(100);

    // TEST 1:
    // Normal room broadcast crosses Redis

    console.log("");
    console.log("TEST 1: cross-server broadcastRoom");

    clearMessages(
        clientA1,
        clientA2,
        clientB1,
        clientB2
    );

    await serverA.broadcastRoom(
        ROOM,
        "message",
        "broadcast-1"
    );

    await waitUntil(
        () =>
            clientA1.messages.length === 1 &&
            clientA2.messages.length === 1 &&
            clientB1.messages.length === 1,
        "room members to receive broadcast-1"
    );

    // give B2 enough time to incorrectly receive it if room filtering is broken.
    await sleep(150);

    assert.deepEqual(
        clientA1.messages,
        ["broadcast-1"]
    );

    assert.deepEqual(
        clientA2.messages,
        ["broadcast-1"]
    );

    assert.deepEqual(
        clientB1.messages,
        ["broadcast-1"]
    );

    assert.deepEqual(
        clientB2.messages,
        []
    );

    console.log(
        "✓ A1 received local room broadcast"
    );

    console.log(
        "✓ A2 received local room broadcast"
    );

    console.log(
        "✓ B1 received Redis room broadcast"
    );

    console.log(
        "✓ B2 was correctly excluded by room"
    );


    // TEST 2:
    // A does NOT double-deliver its own Redis echo

    console.log("");
    console.log("TEST 2: no Redis echo double-delivery");

    assert.equal(
        clientA1.messages.length,
        1,
        "A1 received the same broadcast more than once"
    );

    assert.equal(
        clientA2.messages.length,
        1,
        "A2 received the same broadcast more than once"
    );

    console.log(
        "✓ originating server did not double-deliver Redis echo"
    );


    // TEST 3:
    // broadcastRoomExcept()
    //
    // A1 sends/excluded
    //
    // expect:
    //   A1 N
    //   A2 Y
    //   B1 Y
    //   B2 N
    //
    // intentionally have the SAME numeric connection ID to test a bug that i made cuz im dumb

    console.log("");
    console.log(
        "TEST 3: broadcastRoomExcept with ID collision"
    );

    clearMessages(
        clientA1,
        clientA2,
        clientB1,
        clientB2
    );

    await serverA.broadcastRoomExcept(
        connectionA1,
        ROOM,
        "message",
        "except-test"
    );

    await waitUntil(
        () =>
            clientA2.messages.length === 1 &&
            clientB1.messages.length === 1,
        "A2 and B1 to receive except-test"
    );

    await sleep(150);

    assert.deepEqual(
        clientA1.messages,
        [],
        "originating A1 should have been excluded"
    );

    assert.deepEqual(
        clientA2.messages,
        ["except-test"],
        "A2 should receive the local broadcast"
    );

    assert.deepEqual(
        clientB1.messages,
        ["except-test"],
        [
            "B1 should receive the remote broadcast.",
            "If this failed because B1 has the same ID as A1,",
            "the old exceptConnectionId bug still exists.",
        ].join(" ")
    );

    assert.deepEqual(
        clientB2.messages,
        [],
        "B2 is in a different room"
    );

    console.log(
        "✓ A1 correctly excluded"
    );

    console.log(
        "✓ A2 correctly received"
    );

    console.log(
        "✓ B1 received despite sharing A1's connection ID"
    );

    console.log(
        "✓ B2 remained excluded"
    );


    // TEST 4:
    // broadcasts from the other server
    //
    // so that we can see that the transport is bidirectional.

    console.log("");
    console.log("TEST 4: Server B -> Server A");

    clearMessages(
        clientA1,
        clientA2,
        clientB1,
        clientB2
    );

    await serverB.broadcastRoom(
        ROOM,
        "message",
        "from-server-b"
    );

    await waitUntil(
        () =>
            clientA1.messages.length === 1 &&
            clientA2.messages.length === 1 &&
            clientB1.messages.length === 1,
        "Server B broadcast to reach room members"
    );

    await sleep(150);

    assert.deepEqual(
        clientA1.messages,
        ["from-server-b"]
    );

    assert.deepEqual(
        clientA2.messages,
        ["from-server-b"]
    );

    assert.deepEqual(
        clientB1.messages,
        ["from-server-b"]
    );

    assert.deepEqual(
        clientB2.messages,
        []
    );

    console.log(
        "✓ Redis transport works in both directions"
    );


    // TEST 5:
    // leave room

    console.log("");
    console.log("TEST 5: leaving a room");

    serverB.leave(
        connectionB1,
        ROOM
    );

    clearMessages(
        clientA1,
        clientA2,
        clientB1,
        clientB2
    );

    await serverA.broadcastRoom(
        ROOM,
        "message",
        "after-leave"
    );

    await waitUntil(
        () =>
            clientA1.messages.length === 1 &&
            clientA2.messages.length === 1,
        "remaining room members to receive after-leave"
    );

    await sleep(150);

    assert.deepEqual(
        clientA1.messages,
        ["after-leave"]
    );

    assert.deepEqual(
        clientA2.messages,
        ["after-leave"]
    );

    assert.deepEqual(
        clientB1.messages,
        [],
        "B1 left the room and should not receive anything"
    );

    assert.deepEqual(
        clientB2.messages,
        []
    );

    console.log(
        "✓ leaving room stops remote broadcasts"
    );


    // SUCCESS YAYAYAY

    console.log("");
    console.log("====================================");
    console.log(" ALL REDIS ADAPTER TESTS PASSED ✓");
    console.log("====================================");
    console.log("");
}
catch (error) {
    console.error("");
    console.error("====================================");
    console.error(" REDIS ADAPTER TEST FAILED ✗");
    console.error("====================================");
    console.error("");

    console.error(error);

    process.exitCode = 1;
}
finally {
    // close cleanupo whatever

    for (
        const client of [
            clientA1,
            clientA2,
            clientB1,
            clientB2,
        ]
    ) {
        try {
            client?.socket.close();
        }
        catch {
            // ignore :)
        }
    }


    // close servers + adapters
    //
    // SonicWSServer.shutdown() is expected to shut down its adapter as part
    // of the server lifecycle, so this should auto close it

    const shutdowns = [];

    if (serverA) {
        shutdowns.push(
            closeServer(serverA)
        );
    }

    if (serverB) {
        shutdowns.push(
            closeServer(serverB)
        );
    }

    await Promise.allSettled(
        shutdowns
    );

    console.log("Cleanup complete.");
}