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
import {
  decodeNative, decodeNativeBatch, decodeNativeObject, encodeNative, encodeNativeBatch,
  encodeNativeObject, initializeWasmCore, setNativeCore, validateNative, validateNativeObject,
} from "../../../ts/native/wrapper";
import { PacketType as SonicPacketType } from "../../../ts/ws/packets/PacketType";
import { EnumPackage } from "../../../ts/ws/util/enums/EnumType";
import { CreateObjPacket, CreatePacket } from "../../../ts/ws/util/packets/PacketUtils";
import { BatchHelper } from "../../../ts/ws/util/packets/BatchHelper";
import { PacketHolder } from "../../../ts/ws/util/packets/PacketHolder";
import { compressJSON, decompressJSON } from "../../../ts/ws/util/packets/JSONUtil";

type NativeCore = {
  encodeSigned(kind: number, values: number[]): Buffer;
  decodeSigned(kind: number, data: Buffer): number[];
  encodeUnsigned(kind: number, values: number[]): Buffer;
  decodeUnsigned(kind: number, data: Buffer): number[];
  encodeFloats(kind: number, values: number[]): Buffer;
  decodeFloats(kind: number, data: Buffer): number[];
  encodeStrings(kind: number, values: string[]): Buffer;
  decodeStrings(kind: number, data: Buffer): string[];
  encodeBooleans(values: boolean[]): Buffer;
  decodeBooleans(data: Buffer, count: number): boolean[];
  encodeRaw(data: Buffer): Buffer;
  decodeRaw(data: Buffer): Buffer;
  encodeHex(value: string): Buffer;
  decodeHex(data: Buffer): string;
  frameObject(sectors: Buffer[]): Buffer;
  unframeObject(data: Buffer, fieldCount: number): Buffer[];
  encodeBatch(payloads: Buffer[], compress: boolean): Buffer;
  decodeBatch(data: Buffer, compressed: boolean, maxBatchSize: number, maxOutputSize?: number): Buffer[];
  deflateRaw(data: Buffer): Buffer;
  inflateRaw(data: Buffer, maxOutputSize?: number): Buffer;
  validateEncoded(kind: number, data: Buffer, min: number, max: number,
    compressed: boolean, batched: boolean, maxBatchSize?: number): void;
  validateEnum(data: Buffer, enumSize: number, min: number, max: number): void;
  validateObject(data: Buffer, kinds: number[], minimums: number[],
    maximums: number[], enumSizes: number[]): void;
};

const native = require("./sonic_ws_core.node") as NativeCore;
setNativeCore(native);

const PacketType = {
  RAW: 1,
  STRINGS_ASCII: 2,
  STRINGS_UTF16: 3,
  ENUMS: 4,
  BYTES: 5,
  UBYTES: 6,
  SHORTS: 7,
  USHORTS: 8,
  VARINT: 9,
  UVARINT: 10,
  DELTAS: 11,
  FLOATS: 12,
  DOUBLES: 13,
  BOOLEANS: 14,
  HEX: 17,
} as const;

const bytes = (value: Buffer | Uint8Array) => [...value];
const buffers = (values: Buffer[]) => values.map(value => bytes(value));

let passed = 0;
function test(name: string, fn: () => void): void {
  try {
    fn();
    passed++;
    console.log(`ok ${passed} - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    throw error;
  }
}

test("exports the complete native API", () => {
  const expected = [
    "decodeBatch", "decodeBooleans", "decodeFloats", "decodeHex", "decodeRaw",
    "decodeSigned", "decodeStrings", "decodeUnsigned", "deflateRaw", "encodeBatch",
    "encodeBooleans", "encodeFloats", "encodeHex", "encodeRaw", "encodeSigned",
    "encodeStrings", "encodeUnsigned", "frameObject", "inflateRaw", "unframeObject",
    "validateEncoded", "validateEnum", "validateObject",
  ];
  assert.deepEqual(Object.keys(native).sort(), expected.sort());
});

test("encodes and decodes signed packet modes", () => {
  const cases: Array<[number, number[]]> = [
    [PacketType.BYTES, [-128, -1, 0, 1, 127]],
    [PacketType.SHORTS, [-32768, -1, 0, 1, 32767]],
    [PacketType.VARINT, [-2147483648, -1, 0, 1, 2147483647]],
    [PacketType.DELTAS, [-50, -25, 0, 500, 500, -5]],
  ];
  for (const [kind, values] of cases) {
    assert.deepEqual(native.decodeSigned(kind, native.encodeSigned(kind, values)), values);
  }
  assert.throws(() => native.encodeSigned(PacketType.BYTES, [128]), /overflow/);
  assert.throws(() => native.encodeSigned(PacketType.SHORTS, [-32769]), /overflow/);
});

test("encodes and decodes unsigned packet modes", () => {
  const cases: Array<[number, number[]]> = [
    [PacketType.UBYTES, [0, 1, 254, 255]],
    [PacketType.USHORTS, [0, 1, 65534, 65535]],
    [PacketType.UVARINT, [0, 1, 127, 128, 16384, 4294967295]],
  ];
  for (const [kind, values] of cases) {
    assert.deepEqual(native.decodeUnsigned(kind, native.encodeUnsigned(kind, values)), values);
  }
  assert.throws(() => native.encodeUnsigned(PacketType.UBYTES, [256]), /overflow/);
});

test("matches TypeScript float and double wire formats", () => {
  assert.deepEqual(bytes(native.encodeFloats(PacketType.FLOATS, [1.5])), [0x3f, 0xc0, 0, 0]);
  assert.deepEqual(bytes(native.encodeFloats(PacketType.DOUBLES, [1.5])), [0x3c, 0xcc, 0, 0, 0, 0, 0, 0]);

  const floats = native.decodeFloats(PacketType.FLOATS,
    native.encodeFloats(PacketType.FLOATS, [0, -0, Infinity, -Infinity, NaN, 1.5]));
  assert.equal(Object.is(floats[0], -0), false);
  assert.equal(Object.is(floats[1], -0), false);
  assert.equal(Number.isNaN(floats[2]), true); // Matches the existing TS float decoder.
  assert.equal(Number.isNaN(floats[3]), true);
  assert.equal(Number.isNaN(floats[4]), true);
  assert.equal(floats[5], 1.5);

  const doubles = native.decodeFloats(PacketType.DOUBLES,
    native.encodeFloats(PacketType.DOUBLES, [Infinity, -Infinity, 958412.128498]));
  assert.equal(doubles[0], Infinity);
  assert.equal(doubles[1], -Infinity);
  assert.ok(Math.abs(doubles[2] - 958412.128498) < 1e-9);
});

test("encodes and decodes ASCII and codepoint strings", () => {
  const ascii = ["hello world", "SonicWS"];
  const asciiData = native.encodeStrings(PacketType.STRINGS_ASCII, ascii);
  assert.equal(asciiData.toString("hex"), "020b0795523469e01067c98d1d4cf9b3a29e52");
  assert.deepEqual(native.decodeStrings(PacketType.STRINGS_ASCII, asciiData), ascii);

  const unicode = ["another😂", "𐍈", "𝄞", "🧪", ""];
  assert.deepEqual(native.decodeStrings(PacketType.STRINGS_UTF16,
    native.encodeStrings(PacketType.STRINGS_UTF16, unicode)), unicode);
  assert.throws(() => native.encodeStrings(PacketType.STRINGS_ASCII, ["😂"]), /Huffman/);
});

test("packs booleans MSB-first and honors decode count", () => {
  const data = native.encodeBooleans([true, false, true]);
  assert.deepEqual(bytes(data), [0xa0]);
  assert.deepEqual(native.decodeBooleans(data, 3), [true, false, true]);
});

test("preserves RAW and HEX data", () => {
  const raw = Buffer.from(Array.from({ length: 256 }, (_, index) => index));
  assert.deepEqual(native.decodeRaw(native.encodeRaw(raw)), raw);
  assert.deepEqual(bytes(native.encodeHex("00abff")), [0, 0xab, 0xff]);
  assert.equal(native.decodeHex(Buffer.from([0, 0xab, 0xff])), "00abff");
  assert.throws(() => native.encodeHex("abc"), /odd length/);
  assert.throws(() => native.encodeHex("zz"), /invalid hex/);
});

test("frames and unframes object sectors", () => {
  const sectors = [Buffer.from([7, 8]), Buffer.alloc(0), Buffer.from([0x80])];
  const framed = native.frameObject(sectors);
  assert.deepEqual(bytes(framed), [2, 7, 8, 0, 1, 0x80]);
  assert.deepEqual(buffers(native.unframeObject(framed, 3)), buffers(sectors));
  assert.throws(() => native.unframeObject(framed, 2), /max_batch_size|field count/);
  assert.throws(() => native.unframeObject(Buffer.from([2, 7]), 1), /needed 2 bytes/);
});

test("roundtrips uncompressed and compressed batches", () => {
  const payloads = [Buffer.from([1, 2, 3]), Buffer.alloc(0), Buffer.from([255])];
  for (const compressed of [false, true]) {
    const encoded = native.encodeBatch(payloads, compressed);
    assert.deepEqual(buffers(native.decodeBatch(encoded, compressed, 0)), buffers(payloads));
  }
  const encoded = native.encodeBatch(payloads, false);
  assert.throws(() => native.decodeBatch(encoded, false, 2), /max_batch_size/);
  assert.throws(() => native.decodeBatch(Buffer.from([3, 1, 2]), false, 0), /needed 3 bytes/);
});

test("roundtrips raw DEFLATE", () => {
  const input = Buffer.from("sonic websocket compression ".repeat(20));
  const compressed = native.deflateRaw(input);
  assert.ok(compressed.length < input.length);
  assert.deepEqual(native.inflateRaw(compressed), input);
  assert.throws(() => native.inflateRaw(compressed, input.length - 1), /exceeds limit/);
  assert.throws(() => native.inflateRaw(Buffer.from([0xff])), /deflate/);
});

test("validates normal and compressed encoded packets", () => {
  const data = native.encodeUnsigned(PacketType.UVARINT, [1, 2, 3]);
  native.validateEncoded(PacketType.UVARINT, data, 3, 3, false, false);
  assert.throws(() => native.validateEncoded(PacketType.UVARINT, data, 4, 5, false, false), /outside schema limits/);
  assert.throws(() => native.validateEncoded(PacketType.FLOATS, Buffer.alloc(3), 0, 1, false, false), /four-byte aligned/);

  const compressed = native.deflateRaw(data);
  native.validateEncoded(PacketType.UVARINT, compressed, 3, 3, true, false);
  const bomb = native.deflateRaw(Buffer.alloc(4096, 0x41));
  assert.throws(() => native.validateEncoded(
    PacketType.RAW, bomb, 0, 1, true, false), /exceeds limit/);
  assert.throws(() => native.validateEncoded(
    PacketType.UVARINT, data, 3, 3, true, false), /deflate|outside schema limits/);
});

test("validates every payload in compressed and uncompressed batches", () => {
  const validPayloads = [
    native.encodeUnsigned(PacketType.UVARINT, [1, 2]),
    native.encodeUnsigned(PacketType.UVARINT, [128]),
  ];
  for (const compressed of [false, true]) {
    const valid = native.encodeBatch(validPayloads, compressed);
    native.validateEncoded(PacketType.UVARINT, valid, 1, 2, compressed, true, 2);

    const invalid = native.encodeBatch([validPayloads[0], Buffer.from([0x80])], compressed);
    assert.throws(() => native.validateEncoded(
      PacketType.UVARINT, invalid, 1, 2, compressed, true, 2), /needed 1 bytes/);

    const tooMany = native.encodeBatch([...validPayloads, validPayloads[0]], compressed);
    assert.throws(() => native.validateEncoded(
      PacketType.UVARINT, tooMany, 1, 2, compressed, true, 2), /max_batch_size/);
  }
});

test("validates enum indices", () => {
  native.validateEnum(Buffer.from([0, 2, 1]), 3, 3, 3);
  assert.throws(() => native.validateEnum(Buffer.from([0, 3]), 3, 1, 3), /enum index/);
  assert.throws(() => native.validateEnum(Buffer.from([]), 3, 1, 3), /outside schema limits/);
});

test("validates framed object sectors and enum order", () => {
  const valid = native.frameObject([
    Buffer.from([1]), // First enum package: size 2.
    native.encodeSigned(PacketType.BYTES, [-1, 0, 1]),
    Buffer.from([2]), // Second enum package: size 3.
  ]);
  native.validateObject(valid,
    [PacketType.ENUMS, PacketType.BYTES, PacketType.ENUMS],
    [1, 3, 1], [1, 3, 1], [2, 3]);

  const wrongSecondEnum = native.frameObject([
    Buffer.from([1]), native.encodeSigned(PacketType.BYTES, [-1, 0, 1]), Buffer.from([3]),
  ]);
  assert.throws(() => native.validateObject(wrongSecondEnum,
    [PacketType.ENUMS, PacketType.BYTES, PacketType.ENUMS],
    [1, 3, 1], [1, 3, 1], [2, 3]), /enum index/);

  assert.throws(() => native.validateObject(Buffer.from(valid.subarray(0, valid.length - 2)),
    [PacketType.ENUMS, PacketType.BYTES, PacketType.ENUMS],
    [1, 3, 1], [1, 3, 1], [2, 3]), /missing object sector|needed/);
});

test("rejects invalid packet kinds and mismatched typed helpers", () => {
  assert.throws(() => native.encodeRaw(Buffer.from([1])) && native.validateEncoded(
    99, Buffer.alloc(0), 0, 0, false, false), /unknown packet type/);
  assert.throws(() => native.encodeFloats(PacketType.UVARINT, [1.5]), /expected unsigned integer/);
  assert.throws(() => native.decodeStrings(PacketType.UVARINT, Buffer.from([1])), /did not decode strings/);
});

test("high-level native wrapper dispatches packet modes", () => {
  const signed = [-128, -1, 0, 1, 127];
  assert.deepEqual(decodeNative(SonicPacketType.BYTES,
    encodeNative(SonicPacketType.BYTES, signed)), signed);

  const strings = ["hello", "world"];
  assert.deepEqual(decodeNative(SonicPacketType.STRINGS_ASCII,
    encodeNative(SonicPacketType.STRINGS_ASCII, strings)), strings);

  const bools = [true, false, true];
  assert.deepEqual(decodeNative(SonicPacketType.BOOLEANS,
    encodeNative(SonicPacketType.BOOLEANS, bools), bools.length), bools);

  const enumData = new EnumPackage("wrapper-mixed", ["yes", 1, true, null, undefined]);
  const enumValues = ["yes", 1, true, null, undefined];
  const enumBytes = encodeNative(SonicPacketType.ENUMS, enumValues, enumData);
  assert.deepEqual(bytes(enumBytes), [0, 1, 2, 3, 4]);
  assert.deepEqual(decodeNative(SonicPacketType.ENUMS, enumBytes, 5, enumData), enumValues);
  validateNative(SonicPacketType.ENUMS, enumBytes, 5, 5, { enumData });

  const applicationData = Uint8Array.from([1, 2, 3]);
  assert.deepEqual(bytes(encodeNative(SonicPacketType.JSON, applicationData)), [1, 2, 3]);
  assert.deepEqual(bytes(decodeNative(SonicPacketType.JSON, applicationData) as Uint8Array), [1, 2, 3]);
  assert.throws(() => encodeNative(SonicPacketType.JSON, {}), /requires a Uint8Array/);
});

function toBuffers(values: readonly Uint8Array[]): Buffer[] {
  return values.map((v) => Buffer.from(v));
}

test("high-level wrapper handles objects and batches", () => {
  const firstEnum = new EnumPackage("wrapper-first", ["a", "b"]);
  const secondEnum = new EnumPackage("wrapper-second", ["x", "y", "z"]);
  const schema = {
    types: [SonicPacketType.ENUMS, SonicPacketType.BYTES, SonicPacketType.ENUMS],
    dataMins: [1, 3, 1],
    dataMaxes: [1, 3, 1],
    enumData: [firstEnum, secondEnum],
  };
  const fields = [["b"], [-1, 0, 1], ["z"]];
  const framed = encodeNativeObject(schema, fields);
  assert.deepEqual(bytes(framed), [1, 1, 3, 1, 0, 2, 1, 2]);
  assert.deepEqual(decodeNativeObject(schema, framed), fields);
  validateNativeObject(schema, framed);

  const jsonValue = [{ ok: true, nested: [1, "two", null] }];
  const jsonSchema = {
    types: [SonicPacketType.JSON],
    dataMins: [1],
    dataMaxes: [1],
    enumData: [],
  };
  const jsonFrame = encodeNativeObject(jsonSchema, [compressJSON(jsonValue)]);
  validateNativeObject(jsonSchema, jsonFrame);
  assert.deepEqual(decompressJSON(decodeNativeObject(jsonSchema, jsonFrame)[0] as Uint8Array), jsonValue);

  const payloads = [Buffer.from([1, 2]), Buffer.alloc(0), Buffer.from([255])];
  for (const compressed of [false, true]) {
    const batch = encodeNativeBatch(payloads, compressed);
    assert.deepStrictEqual(
        toBuffers(decodeNativeBatch(batch, compressed)),
        toBuffers(payloads)
    );
  }
});

test("legacy JSON codec remains self-contained and wire-compatible", () => {
  const value = { ok: true, n: -12, text: "Sonic", list: [null, 1.5, false] };
  const encoded = compressJSON(value);
  assert.equal(Buffer.from(encoded).toString("hex"),
    "010380c54a1904026f6b016e17047465787405536f6e6963046c697374033fc00000");
  assert.deepEqual(decompressJSON(encoded), value);
});

async function runPacketIntegrationTests(): Promise<void> {
  const numbers = CreatePacket({ tag: "native-uvarint", type: SonicPacketType.UVARINT, dataMin: 3, dataMax: 3 });
  const encoded = await numbers.processSend([1, 128, 16384]);
  const [validated] = await numbers.validate(encoded);
  assert.deepEqual(numbers.processReceive(validated, true), [1, 128, 16384]);

  const object = CreateObjPacket({
    tag: "native-object",
    types: [SonicPacketType.STRINGS_ASCII, SonicPacketType.BOOLEANS, SonicPacketType.BYTES] as const,
    dataMins: [2, 3, 3],
    dataMaxes: [2, 3, 3],
  });
  const fields = [["hello", "world"], [true, false, true], [-1, 0, 1]];
  const objectData = await object.processSend(fields);
  await object.validate(objectData);
  assert.deepEqual(object.processReceive(objectData, true), fields);

  const enumData = new EnumPackage("packet-object-enum", ["first", "second"]);
  const enumObject = CreateObjPacket({
    tag: "native-enum-object", types: [enumData, SonicPacketType.UBYTES] as const,
  });
  const enumObjectData = await enumObject.processSend([[1], [255]]);
  assert.deepEqual(enumObject.processReceive(enumObjectData, true), [["second"], [255]]);

  const jsonObject = CreateObjPacket({
    tag: "native-json-object",
    types: [SonicPacketType.STRINGS_ASCII, SonicPacketType.JSON] as const,
    dataMins: [1, 1],
    dataMaxes: [1, 1],
    gzipCompression: false,
  });
  const jsonFields = [["metadata"], [{ ok: true, nested: [1, "two", null] }]];
  const jsonObjectData = await jsonObject.processSend(jsonFields);
  await jsonObject.validate(jsonObjectData);
  assert.deepEqual(jsonObject.processReceive(jsonObjectData, true), jsonFields);

  passed++;
  console.log(`ok ${passed} - Packet uses native encode, decode, and validation`);

  const batchedPacket = CreatePacket({
    tag: "native-batch", type: SonicPacketType.RAW, dataMin: 0, dataMax: 10,
    dataBatching: 1, maxBatchSize: 2,
  });
  const holder = new PacketHolder([batchedPacket]);
  const sent: Uint8Array[] = [];
  const connection = {
    setInterval(callback: () => void) { callback(); return 1; },
    raw_send(data: Uint8Array) { sent.push(data); },
  };
  const helper = new BatchHelper();
  helper.registerSendPackets(holder, connection as never);
  helper.batchPacket(holder.getKey("native-batch"), Uint8Array.from([7, 8]));
  assert.deepEqual(bytes(sent[0]), [1, 2, 7, 8]);

  passed++;
  console.log(`ok ${passed} - BatchHelper uses native batch framing`);

  await initializeWasmCore();
  const wasmValues = [-128, -1, 0, 1, 127];
  assert.deepEqual(decodeNative(SonicPacketType.BYTES,
    encodeNative(SonicPacketType.BYTES, wasmValues)), wasmValues);
  const wasmBatch = encodeNativeBatch([Uint8Array.from([1, 2]), new Uint8Array(0)], true);
  assert.deepEqual(decodeNativeBatch(wasmBatch, true).map(bytes), [[1, 2], []]);
  const wasmPacket = CreatePacket({ tag: "wasm-uvarint", type: SonicPacketType.UVARINT, dataMin: 2, dataMax: 2 });
  const wasmEncoded = await wasmPacket.processSend([128, 16384]);
  const [wasmValidated] = await wasmPacket.validate(wasmEncoded);
  assert.deepEqual(wasmPacket.processReceive(wasmValidated, true), [128, 16384]);

  passed++;
  console.log(`ok ${passed} - Node WASM fallback uses the same wrapper and Packet API`);
}

runPacketIntegrationTests()
  .then(() => console.log(`1..${passed}`))
  .catch(error => {
    console.error("not ok - Packet/BatchHelper native integration");
    console.error(error);
    process.exitCode = 1;
  });
