import assert from "node:assert/strict";
import WS from "ws";
import { SonicWSServer } from "../dist/index.js";
import { decodeControl } from "../dist/ws/util/packets/ControlProtocol.js";

assert.throws(() => decodeControl(Uint8Array.from([])), /invalid.*control/i);
assert.throws(() => decodeControl(Uint8Array.from([0, 99, 0])), /unknown.*control/i);
assert.throws(() => decodeControl(Uint8Array.from([0, 1, 0])), /missing.*packet key/i);
assert.throws(() => decodeControl(Uint8Array.from([0, 1, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80])), /varint|variable/i);

async function closeFor(frame) {
    const server = new SonicWSServer({
        websocketOptions: { host: "127.0.0.1", port: 0 },
        sonicServerSettings: { checkForUpdates: false },
    });
    await new Promise(resolve => server.on_ready(resolve));
    const address = server.wss.address();
    const socket = new WS(`ws://127.0.0.1:${address.port}`);
    await new Promise((resolve, reject) => {
        socket.once("message", resolve);
        socket.once("error", reject);
    });
    socket.send(frame);
    const code = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("malformed-frame close timed out")), 2_000);
        socket.once("close", code => { clearTimeout(timer); resolve(code); });
    });
    await new Promise(resolve => server.shutdown(() => resolve()));
    return code;
}

assert.equal(await closeFor(Uint8Array.from([255])), 4002, "invalid packet key");
assert.equal(await closeFor(Uint8Array.from([0, 99, 0])), 4004, "invalid control frame");
assert.equal(await closeFor(Uint8Array.from([])), 4001, "empty frame");
console.log("malformed packet keys, control frames, varints, and empty frames were rejected");
