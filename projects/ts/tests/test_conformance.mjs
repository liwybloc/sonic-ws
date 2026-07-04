import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { CreatePacket, PacketType } from "../dist/index.js";

const corpus = JSON.parse(await readFile(new URL("../../../protocol/golden-vectors.json", import.meta.url)));
assert.equal(corpus.protocolVersion, 24);

for (const vector of corpus.vectors) {
    const count = vector.type === "HEX" ? vector.values[0].length / 2 : Array.isArray(vector.values) ? vector.values.length : vector.schema?.length ?? 1;
    const packet = CreatePacket({
        tag: vector.name,
        type: PacketType[vector.type],
        schema: vector.schema,
        autoFlatten: vector.autoFlatten,
        quantized: vector.quantized,
        dataMin: vector.autoFlatten ? undefined : vector.type === "HEX" ? 1 : count,
        dataMax: vector.autoFlatten ? undefined : vector.type === "HEX" ? count : count,
    });
    const input = vector.schema ? [vector.values] : vector.values;
    const prepared = packet.prepareSend(input, 0);
    const encoded = prepared.length ? await packet.processSend(prepared) : new Uint8Array();
    assert.equal(Buffer.from(encoded).toString("hex"), vector.hex, `${vector.name} encoded bytes`);
    const decoded = await packet.listen(encoded, null);
    assert.notEqual(typeof decoded, "string", vector.name);
    assert.deepEqual(decoded[0], vector.type === "HEX" ? vector.values[0] : vector.values, `${vector.name} decoded value`);
}

console.log(`passed ${corpus.vectors.length} shared protocol golden vectors`);
