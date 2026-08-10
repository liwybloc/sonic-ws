import assert from "node:assert/strict";

import {
    createPostgresAdapter,
} from "../dist/index.js";

const connectionString =
    process.env.POSTGRES_URL ??
    "postgres://postgres:postgres@localhost:5432/postgres";

const channel =
    `sonic_ws_test_${process.pid}_${Date.now()}`;

const adapterA =
    createPostgresAdapter({
        connectionString,
        channel,
    });

const adapterB =
    createPostgresAdapter({
        connectionString,
        channel,
    });

const receivedA = [];
const receivedB = [];

function wait(ms) {
    return new Promise(resolve => {
        setTimeout(resolve, ms);
    });
}

async function waitFor(
    condition,
    timeout = 2000
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

async function main() {
    console.log(
        "starting PostgreSQL adapter test"
    );

    console.log(
        `channel: ${channel}`
    );

    await Promise.all([
        adapterA.start(
            "server-a",
            message => {
                receivedA.push(
                    message
                );
            }
        ),

        adapterB.start(
            "server-b",
            message => {
                receivedB.push(
                    message
                );
            }
        ),
    ]);

    console.log(
        "adapters connected"
    );

    await test(
        "A -> B broadcast",
        async () => {
            receivedA.length = 0;
            receivedB.length = 0;

            const message = {
                origin: "server-a",
                room: "room-1",
                packetTag: "message",
                values: [
                    "hello from a",
                    123,
                ],
            };

            await adapterA.publish(
                message
            );

            await waitFor(
                () =>
                    receivedB.length === 1
            );

            assert.deepEqual(
                receivedB[0],
                message
            );
        }
    );

    await test(
        "B -> A broadcast",
        async () => {
            receivedA.length = 0;
            receivedB.length = 0;

            const message = {
                origin: "server-b",
                room: "room-1",
                packetTag: "message",
                values: [
                    "hello from b",
                    456,
                ],
            };

            await adapterB.publish(
                message
            );

            await waitFor(
                () =>
                    receivedA.length === 1
            );

            assert.deepEqual(
                receivedA[0],
                message
            );
        }
    );

    await test(
        "publisher receives PostgreSQL echo",
        async () => {
            receivedA.length = 0;
            receivedB.length = 0;

            const message = {
                origin: "server-a",
                room: "echo-room",
                packetTag: "echo",
                values: [
                    "test",
                ],
            };

            await adapterA.publish(
                message
            );

            await waitFor(
                () =>
                    receivedA.length === 1 &&
                    receivedB.length === 1
            );

            assert.deepEqual(
                receivedA[0],
                message
            );

            assert.deepEqual(
                receivedB[0],
                message
            );
        }
    );

    await test(
        "room name is preserved",
        async () => {
            receivedA.length = 0;
            receivedB.length = 0;

            await adapterA.publish({
                origin: "server-a",
                room: "alpha-room",
                packetTag: "room-test",
                values: [
                    1,
                ],
            });

            await waitFor(
                () =>
                    receivedB.length === 1
            );

            assert.equal(
                receivedB[0].room,
                "alpha-room"
            );
        }
    );

    await test(
        "packet tag is preserved",
        async () => {
            receivedA.length = 0;
            receivedB.length = 0;

            await adapterA.publish({
                origin: "server-a",
                room: "room-1",
                packetTag:
                    "special-packet",
                values: [],
            });

            await waitFor(
                () =>
                    receivedB.length === 1
            );

            assert.equal(
                receivedB[0].packetTag,
                "special-packet"
            );
        }
    );

    await test(
        "complex values survive serialization",
        async () => {
            receivedA.length = 0;
            receivedB.length = 0;

            const message = {
                origin: "server-a",
                room: "room-1",
                packetTag: "complex",
                values: [
                    123,
                    -55,
                    1.25,
                    true,
                    false,
                    null,
                    "hello",
                    [1, 2, 3],
                    {
                        id: 10,
                        name: "test",
                    },
                    Buffer.from(
                        [1, 2, 3, 4]
                    ),
                    BigInt(
                        "9007199254740993"
                    ),
                ],
            };

            await adapterA.publish(
                message
            );

            await waitFor(
                () =>
                    receivedB.length === 1
            );

            assert.deepEqual(
                receivedB[0],
                message
            );
        }
    );

    await test(
        "multiple broadcasts preserve order",
        async () => {
            receivedA.length = 0;
            receivedB.length = 0;

            for (
                let i = 0;
                i < 20;
                i++
            ) {
                await adapterA.publish({
                    origin: "server-a",
                    room: "order-room",
                    packetTag: "sequence",
                    values: [
                        i,
                    ],
                });
            }

            await waitFor(
                () =>
                    receivedB.length === 20
            );

            assert.deepEqual(
                receivedB.map(
                    message =>
                        message.values[0]
                ),
                Array.from(
                    {
                        length: 20,
                    },
                    (_, index) =>
                        index
                )
            );
        }
    );

    await test(
        "join leave and disconnect are safe no-ops",
        async () => {
            adapterA.join(
                1,
                "room-1"
            );

            adapterA.leave(
                1,
                "room-1"
            );

            adapterA.disconnect(
                1
            );
        }
    );

    await test(
        "publish before start throws",
        async () => {
            const adapter =
                createPostgresAdapter({
                    connectionString,
                    channel:
                        `${channel}_not_started`,
                });

            await assert.rejects(
                () =>
                    adapter.publish({
                        origin:
                            "server-unused",
                        room: "room",
                        packetTag:
                            "message",
                        values: [],
                    }),
                /has not been started/
            );

            await adapter.close();
        }
    );

    await test(
        "oversized payload throws",
        async () => {
            const adapter =
                createPostgresAdapter({
                    connectionString,
                    channel:
                        `${channel}_size`,
                });

            await adapter.start(
                "server-size",
                () => {}
            );

            await assert.rejects(
                () =>
                    adapter.publish({
                        origin:
                            "server-size",
                        room: "room",
                        packetTag:
                            "large",
                        values: [
                            "x".repeat(
                                10000
                            ),
                        ],
                    }),
                /payload/i
            );

            await adapter.close();
        }
    );

    await test(
        "close is idempotent",
        async () => {
            const adapter =
                createPostgresAdapter({
                    connectionString,
                    channel:
                        `${channel}_close`,
                });

            await adapter.start(
                "server-close",
                () => {}
            );

            await adapter.close();
            await adapter.close();
        }
    );

    await test(
        "publish after close throws",
        async () => {
            const adapter =
                createPostgresAdapter({
                    connectionString,
                    channel:
                        `${channel}_closed`,
                });

            await adapter.start(
                "server-closed",
                () => {}
            );

            await adapter.close();

            await assert.rejects(
                () =>
                    adapter.publish({
                        origin:
                            "server-closed",
                        room: "room",
                        packetTag:
                            "message",
                        values: [],
                    }),
                /closed/
            );
        }
    );

    await test(
        "start after close throws",
        async () => {
            const adapter =
                createPostgresAdapter({
                    connectionString,
                    channel:
                        `${channel}_restart`,
                });

            await adapter.close();

            await assert.rejects(
                () =>
                    adapter.start(
                        "server-restart",
                        () => {}
                    ),
                /closed/
            );
        }
    );

    console.log(
        "\nall PostgreSQL adapter tests passed"
    );
}

main()
    .catch(error => {
        console.error(
            "\nPostgreSQL adapter test failed"
        );

        console.error(
            error
        );

        process.exitCode = 1;
    })
    .finally(async () => {
        await Promise.allSettled([
            adapterA.close(),
            adapterB.close(),
        ]);
    });