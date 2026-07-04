import assert from "node:assert/strict";
const { SonicWS, SonicWSServer, PacketType, CreatePacket } = await import("../dist/index.js");

const packet = CreatePacket({ tag: "news", type: PacketType.VARINT, replay: true });
const server = new SonicWSServer({
    clientPackets: [],
    serverPackets: [packet],
    websocketOptions: { host: "127.0.0.1", port: 0 },
    sonicServerSettings: { checkForUpdates: false },
    recovery: { maxDisconnectionMs: 5_000, maxPackets: 10 },
});

const timeout = (promise, label) => Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`Timed out: ${label}`)), 5_000)),
]);

try {
    await timeout(new Promise(resolve => server.on_ready(resolve)), "server ready");
    const address = server.wss.address();
    const firstConnection = new Promise(resolve => server.on_connect(resolve));
    const client = await SonicWS.connect(`ws://127.0.0.1:${address.port}`, {
        reconnect: { enabled: true, attempts: 5, minDelayMs: 150, maxDelayMs: 150, jitter: 0 },
    });
    const original = await firstConnection;
    original.state.player = { id: 42 };
    original.join("world:one");

    const received = [];
    client.on("news", value => received.push(value));
    await original.send("news", 1);
    await timeout(new Promise(resolve => {
        const poll = setInterval(() => received.includes(1) && (clearInterval(poll), resolve()), 5);
    }), "first replayable packet");

    const recovered = new Promise(resolve => client.on_recovered(resolve));
    client.socket.terminate();
    await timeout(new Promise(resolve => {
        const poll = setInterval(() => server.connections.length === 0 && (clearInterval(poll), resolve()), 5);
    }), "old connection removal");
    const missedPayload = await packet.processSend([2]);
    server.replayFrame(original, Uint8Array.from([1, ...missedPayload]));
    for (let index = 0; index < 20; index++) server.replayFrame(original, Uint8Array.from([1, ...missedPayload]));
    assert.equal(server.sessions.get(original.sessionId).frames.length, 10, "replay maxPackets bound");

    assert.deepEqual(await timeout(recovered, "session recovery"), { recovered: true, replayed: 10 });
    await timeout(new Promise(resolve => {
        const poll = setInterval(() => received.includes(2) && (clearInterval(poll), resolve()), 5);
    }), "missed packet replay");
    const replacement = server.connections[0];
    assert.deepEqual(replacement.state.player, { id: 42 });
    assert(replacement.getRooms().has("world:one"));
    client.close();
    console.log("reconnect, state recovery, room recovery, and missed replay passed");
} finally {
    await new Promise(resolve => server.shutdown(() => resolve()));
}
