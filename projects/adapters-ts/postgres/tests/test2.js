import assert from "node:assert/strict";

import {
    SonicWS,
    SonicWSServer,
    PacketType,
    CreatePacket,
} from "sonic-ws";

import {
    createPostgresAdapter,
} from "../dist/index.js";

const connectionString =
    process.env.POSTGRES_URL ??
    "postgres://postgres:postgres@localhost:5432/postgres";

const channel =
    `sonic_ws_test_${process.pid}_${Date.now()}`;

const room =
    "integration-room";

const otherRoom =
    "other-room";

const packets = [
    CreatePacket({
        tag: "message",
        type: PacketType.STRINGS_ASCII,
        dataMin: 1,
        dataMax: 1,
    }),
];

function wait(ms) {
    return new Promise(resolve => {
        setTimeout(resolve, ms);
    });
}

function withTimeout(
    promise,
    timeout = 5000,
    label = "operation"
) {
    return Promise.race([
        promise,

        new Promise((_, reject) => {
            setTimeout(() => {
                reject(
                    new Error(
                        `Timed out: ${label}`
                    )
                );
            }, timeout);
        }),
    ]);
}

async function waitFor(
    condition,
    timeout = 3000
) {
    const start = Date.now();

    while (!condition()) {
        if (
            Date.now() - start >
            timeout
        ) {
            throw new Error(
                "Timed out waiting for condition"
            );
        }

        await wait(10);
    }
}

async function test(
    name,
    callback
) {
    try {
        await callback();

        console.log(
            `✓ ${name}`
        );
    }
    catch (error) {
        console.error(
            `✗ ${name}`
        );

        throw error;
    }
}

function createServer() {
    const adapter =
        createPostgresAdapter({
            connectionString,
            channel,
        });

    const server =
        new SonicWSServer({
            clientPackets: [],
            serverPackets: packets,

            websocketOptions: {
                host: "127.0.0.1",
                port: 0,
            },

            sonicServerSettings: {
                checkForUpdates: false,
                heartbeat: false,
            },

            adapter,
        });

    return {
        server,
        adapter,
    };
}

async function waitForServer(
    server
) {
    await withTimeout(
        new Promise(resolve => {
            server.on_ready(resolve);
        }),
        5000,
        "server ready"
    );

    const address =
        server.wss.address();

    assert(
        address &&
        typeof address !== "string"
    );

    return address.port;
}

async function connectClient(
    server,
    port
) {
    const connectionPromise =
        new Promise(resolve => {
            server.on_connect(
                resolve
            );
        });

    const client =
        new SonicWS(
            `ws://127.0.0.1:${port}`
        );

    await withTimeout(
        Promise.all([
            connectionPromise,

            new Promise(resolve => {
                client.on_ready(
                    resolve
                );
            }),
        ]),
        5000,
        "client connection"
    );

    return {
        client,
        connection:
            await connectionPromise,
    };
}

function captureMessages(
    client
) {
    const messages = [];

    client.on(
        "message",
        value => {
            messages.push(
                value
            );
        }
    );

    return messages;
}

async function closeClient(
    client
) {
    if (client.isClosed()) {
        return;
    }

    const closed =
        new Promise(resolve => {
            client.on_close(
                resolve
            );
        });

    client.close();

    await withTimeout(
        closed,
        2000,
        "client close"
    ).catch(() => undefined);
}

async function shutdownServer(
    server
) {
    await new Promise(resolve => {
        server.shutdown(
            () => resolve()
        );
    });
}

let serverA;
let serverB;

let adapterA;
let adapterB;

let clientA1;
let clientA2;
let clientB1;
let clientB2;

async function main() {
    console.log(
        "starting PostgreSQL SonicWS integration test"
    );

    console.log(
        `channel: ${channel}`
    );

    const a =
        createServer();

    const b =
        createServer();

    serverA = a.server;
    adapterA = a.adapter;

    serverB = b.server;
    adapterB = b.adapter;

    const [
        portA,
        portB,
    ] = await Promise.all([
        waitForServer(
            serverA
        ),

        waitForServer(
            serverB
        ),
    ]);

    console.log(
        `server A: ${portA}`
    );

    console.log(
        `server B: ${portB}`
    );

    const a1 =
        await connectClient(
            serverA,
            portA
        );

    const a2 =
        await connectClient(
            serverA,
            portA
        );

    const b1 =
        await connectClient(
            serverB,
            portB
        );

    const b2 =
        await connectClient(
            serverB,
            portB
        );

    clientA1 =
        a1.client;

    clientA2 =
        a2.client;

    clientB1 =
        b1.client;

    clientB2 =
        b2.client;

    const connectionA1 =
        a1.connection;

    const connectionA2 =
        a2.connection;

    const connectionB1 =
        b1.connection;

    const connectionB2 =
        b2.connection;

    const messagesA1 =
        captureMessages(
            clientA1
        );

    const messagesA2 =
        captureMessages(
            clientA2
        );

    const messagesB1 =
        captureMessages(
            clientB1
        );

    const messagesB2 =
        captureMessages(
            clientB2
        );

    connectionA1.join(
        room
    );

    connectionA2.join(
        room
    );

    connectionB1.join(
        room
    );

    connectionB2.join(
        otherRoom
    );

    console.log(
        "clients connected and rooms joined"
    );

    await test(
        "connection ids can overlap across servers",
        async () => {
            assert.equal(
                connectionA1.id,
                connectionB1.id
            );

            assert.equal(
                connectionA2.id,
                connectionB2.id
            );
        }
    );

    await test(
        "A -> B room broadcast",
        async () => {
            messagesA1.length = 0;
            messagesA2.length = 0;
            messagesB1.length = 0;
            messagesB2.length = 0;

            await serverA.broadcastRoom(
                room,
                "message",
                "hello from a"
            );

            await waitFor(
                () =>
                    messagesA1.length === 1 &&
                    messagesA2.length === 1 &&
                    messagesB1.length === 1
            );

            assert.deepEqual(
                messagesA1,
                ["hello from a"]
            );

            assert.deepEqual(
                messagesA2,
                ["hello from a"]
            );

            assert.deepEqual(
                messagesB1,
                ["hello from a"]
            );

            assert.deepEqual(
                messagesB2,
                []
            );
        }
    );

    await test(
        "origin server does not double-deliver adapter echo",
        async () => {
            messagesA1.length = 0;
            messagesA2.length = 0;
            messagesB1.length = 0;
            messagesB2.length = 0;

            await serverA.broadcastRoom(
                room,
                "message",
                "single delivery"
            );

            await waitFor(
                () =>
                    messagesA1.length === 1 &&
                    messagesA2.length === 1 &&
                    messagesB1.length === 1
            );

            await wait(
                150
            );

            assert.equal(
                messagesA1.length,
                1
            );

            assert.equal(
                messagesA2.length,
                1
            );

            assert.equal(
                messagesB1.length,
                1
            );

            assert.equal(
                messagesB2.length,
                0
            );
        }
    );

    await test(
        "room isolation works across servers",
        async () => {
            messagesA1.length = 0;
            messagesA2.length = 0;
            messagesB1.length = 0;
            messagesB2.length = 0;

            await serverA.broadcastRoom(
                otherRoom,
                "message",
                "other room"
            );

            await waitFor(
                () =>
                    messagesB2.length === 1
            );

            await wait(
                100
            );

            assert.deepEqual(
                messagesA1,
                []
            );

            assert.deepEqual(
                messagesA2,
                []
            );

            assert.deepEqual(
                messagesB1,
                []
            );

            assert.deepEqual(
                messagesB2,
                ["other room"]
            );
        }
    );

    await test(
        "broadcastRoomExcept excludes only the local sender",
        async () => {
            messagesA1.length = 0;
            messagesA2.length = 0;
            messagesB1.length = 0;
            messagesB2.length = 0;

            await serverA.broadcastRoomExcept(
                connectionA1,
                room,
                "message",
                "except a1"
            );

            await waitFor(
                () =>
                    messagesA2.length === 1 &&
                    messagesB1.length === 1
            );

            await wait(
                100
            );

            assert.deepEqual(
                messagesA1,
                []
            );

            assert.deepEqual(
                messagesA2,
                ["except a1"]
            );

            assert.deepEqual(
                messagesB1,
                ["except a1"]
            );

            assert.deepEqual(
                messagesB2,
                []
            );
        }
    );

    await test(
        "identical connection ids on different servers do not collide",
        async () => {
            assert.equal(
                connectionA1.id,
                connectionB1.id
            );

            messagesA1.length = 0;
            messagesA2.length = 0;
            messagesB1.length = 0;
            messagesB2.length = 0;

            await serverA.broadcastRoomExcept(
                connectionA1,
                room,
                "message",
                "id collision test"
            );

            await waitFor(
                () =>
                    messagesA2.length === 1 &&
                    messagesB1.length === 1
            );

            assert.deepEqual(
                messagesA1,
                []
            );

            assert.deepEqual(
                messagesB1,
                ["id collision test"]
            );
        }
    );

    await test(
        "B -> A room broadcast",
        async () => {
            messagesA1.length = 0;
            messagesA2.length = 0;
            messagesB1.length = 0;
            messagesB2.length = 0;

            await serverB.broadcastRoom(
                room,
                "message",
                "hello from b"
            );

            await waitFor(
                () =>
                    messagesA1.length === 1 &&
                    messagesA2.length === 1 &&
                    messagesB1.length === 1
            );

            assert.deepEqual(
                messagesA1,
                ["hello from b"]
            );

            assert.deepEqual(
                messagesA2,
                ["hello from b"]
            );

            assert.deepEqual(
                messagesB1,
                ["hello from b"]
            );

            assert.deepEqual(
                messagesB2,
                []
            );
        }
    );

    await test(
        "leaving a room stops remote delivery",
        async () => {
            connectionB1.leave(
                room
            );

            assert.equal(
                connectionB1
                    .getRooms()
                    .has(room),
                false
            );

            messagesA1.length = 0;
            messagesA2.length = 0;
            messagesB1.length = 0;
            messagesB2.length = 0;

            await serverA.broadcastRoom(
                room,
                "message",
                "after leave"
            );

            await waitFor(
                () =>
                    messagesA1.length === 1 &&
                    messagesA2.length === 1
            );

            await wait(
                150
            );

            assert.deepEqual(
                messagesA1,
                ["after leave"]
            );

            assert.deepEqual(
                messagesA2,
                ["after leave"]
            );

            assert.deepEqual(
                messagesB1,
                []
            );

            assert.deepEqual(
                messagesB2,
                []
            );
        }
    );

    await test(
        "rejoining a room restores remote delivery",
        async () => {
            connectionB1.join(
                room
            );

            assert.equal(
                connectionB1
                    .getRooms()
                    .has(room),
                true
            );

            messagesB1.length = 0;

            await serverA.broadcastRoom(
                room,
                "message",
                "after rejoin"
            );

            await waitFor(
                () =>
                    messagesB1.length === 1
            );

            assert.deepEqual(
                messagesB1,
                ["after rejoin"]
            );
        }
    );

    await test(
        "disconnect removes local room membership",
        async () => {
            connectionB2.join(
                room
            );

            assert.equal(
                connectionB2
                    .getRooms()
                    .has(room),
                true
            );

            assert.equal(
                serverB
                    .getConnected()
                    .includes(
                        connectionB2
                    ),
                true
            );

            await closeClient(
                clientB2
            );

            await waitFor(
                () =>
                    !serverB
                        .getConnected()
                        .includes(
                            connectionB2
                        )
            );

            messagesA1.length = 0;
            messagesA2.length = 0;
            messagesB1.length = 0;
            messagesB2.length = 0;

            await serverA.broadcastRoom(
                room,
                "message",
                "after disconnect"
            );

            await waitFor(
                () =>
                    messagesA1.length === 1 &&
                    messagesA2.length === 1 &&
                    messagesB1.length === 1
            );

            await wait(
                150
            );

            assert.deepEqual(
                messagesB2,
                []
            );
        }
    );

    console.log(
        "\nall PostgreSQL SonicWS integration tests passed"
    );
}

main()
    .catch(error => {
        console.error(
            "\nPostgreSQL SonicWS integration test failed"
        );

        console.error(
            error
        );

        process.exitCode = 1;
    })
    .finally(async () => {
        await Promise.allSettled([
            clientA1
                ? closeClient(
                    clientA1
                )
                : Promise.resolve(),

            clientA2
                ? closeClient(
                    clientA2
                )
                : Promise.resolve(),

            clientB1
                ? closeClient(
                    clientB1
                )
                : Promise.resolve(),

            clientB2
                ? closeClient(
                    clientB2
                )
                : Promise.resolve(),
        ]);

        await Promise.allSettled([
            serverA
                ? shutdownServer(
                    serverA
                )
                : Promise.resolve(),

            serverB
                ? shutdownServer(
                    serverB
                )
                : Promise.resolve(),
        ]);

        await Promise.allSettled([
            adapterA
                ? adapterA.close()
                : Promise.resolve(),

            adapterB
                ? adapterB.close()
                : Promise.resolve(),
        ]);
    });