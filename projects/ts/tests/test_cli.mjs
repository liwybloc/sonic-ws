import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { CreatePacket, CreatePacketManifest, PacketType } from "../dist/index.js";

const directory = await mkdtemp(join(tmpdir(), "sonicws-cli-"));
try {
    const manifest = join(directory, "packets.swsm");
    const types = join(directory, "packets.d.ts");
    await writeFile(manifest, CreatePacketManifest({
        clientPackets: [CreatePacket({ tag: "movement.move", type: PacketType.VARINT, schema: ["dx", "dy", "dz"], dataMax: 3 })],
        serverPackets: [CreatePacket({ tag: "ready", type: PacketType.NONE })],
    }));
    const run = (...args) => {
        const result = spawnSync(process.execPath, ["bin/sonicws.mjs", ...args], { cwd: new URL("..", import.meta.url), encoding: "utf8" });
        assert.equal(result.status, 0, result.stderr);
        return result.stdout.trim();
    };
    assert.match(run("inspect", manifest), /movement\.move/);
    assert.match(run("validate", manifest), /"valid": true/);
    const encoded = run("encode", manifest, "client", "movement.move", '{"dx":1,"dy":2,"dz":3}');
    assert.deepEqual(JSON.parse(run("decode", manifest, "client", "movement.move", encoded)), { dx: 1, dy: 2, dz: 3 });
    run("types", manifest, types);
    assert.match(await readFile(types, "utf8"), /"movement\.move": \{ "dx": number/);
    console.log("inspector CLI inspect/validate/encode/decode/type generation passed");
} finally {
    await rm(directory, { recursive: true, force: true });
}
