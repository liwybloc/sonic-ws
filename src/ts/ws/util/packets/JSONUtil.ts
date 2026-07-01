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

import { splitArray } from "../BufferUtil";

// JSON remains a TypeScript-only compatibility codec. These helpers are kept
// private here so the shared compression utility only contains schema framing.
const compressBools = (values: boolean[]) => values.reduce((byte, value, index) => byte | (Number(value) << (7 - index)), 0);
const decompressBools = (byte: number) => Array.from({ length: 8 }, (_, index) => (byte & (1 << (7 - index))) !== 0);
const mapZigZag = (value: number) => (value << 1) ^ (value >> 31);
const demapZigZag = (value: number) => (value >>> 1) ^ -(value & 1);
const bytesToBits = (bytes: ArrayLike<number>) => Array.from(bytes, byte => byte.toString(2).padStart(8, "0")).join("");
const bitsToBytes = (bits: string) => new Uint8Array(bits.match(/.{1,8}/g)?.map(byte => parseInt(byte.padEnd(8, "0"), 2)) ?? []);

function convertVarInt(value: number): number[] {
    if (!Number.isInteger(value) || value < 0) throw new Error(`Invalid JSON variable integer: ${value}`);
    const result: number[] = [];
    do {
        let byte = value & 0x7f;
        value >>>= 7;
        if (value > 0) byte |= 0x80;
        result.push(byte);
    } while (value > 0);
    return result;
}

function readVarInt(data: ArrayLike<number>, offset: number): [number, number] {
    let value = 0, shift = 0;
    do {
        if (offset >= data.length || shift > 28) throw new Error("Invalid JSON variable integer");
        const byte = data[offset++];
        value += (byte & 0x7f) << shift;
        if ((byte & 0x80) === 0) return [offset, value];
        shift += 7;
    } while (true);
}

function convertFloat(value: number): number[] {
    if (Number.isNaN(value)) return [0x7f, 0x80, 0, 1];
    const sign = value < 0 ? 1 : 0;
    value = Math.abs(value);
    if (value === 0) return [0, 0, 0, 0];
    const exponent = Math.floor(Math.log2(value));
    if (!Number.isFinite(value) || exponent > 127 || exponent < -126)
        return [sign ? 0xff : 0x7f, 0x80, 0, 0];
    const mantissa = Math.round((value / (2 ** exponent) - 1) * (2 ** 23)) & 0x7fffff;
    const bits = ((sign << 31) | ((exponent + 127) << 23) | mantissa) >>> 0;
    return [bits >>> 24, bits >>> 16 & 0xff, bits >>> 8 & 0xff, bits & 0xff];
}

function deconvertFloat(bytes: number[]): number {
    const bits = ((bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3]) >>> 0;
    const sign = bits >>> 31, rawExponent = bits >>> 23 & 0xff, fraction = bits & 0x7fffff;
    const mantissa = (rawExponent === 0 ? 0 : 1) + fraction / (2 ** 23);
    const value = rawExponent === 0xff ? (mantissa === 0 ? Infinity : NaN)
        : mantissa * (2 ** (rawExponent === 0 ? -126 : rawExponent - 127));
    return sign ? -value : value;
}

enum JSONType {
    NULL = 0,
    BOOL = 1,
    INT = 2,
    FLOAT = 3,
    STRING = 4,
    ARRAY = 5,
    OBJECT = 6,
}

const encodeString = (str: string) => {
    const encoder = new TextEncoder();
    const data = encoder.encode(str);
    return [...convertVarInt(data.length), ...data];
};

const decodeString = (bytes: Uint8Array, offset: number) => {
    const [off, len] = readVarInt(bytes, offset);
    const decoder = new TextDecoder();
    return { value: decoder.decode(bytes.subarray(off, off + len)), length: off + len - offset };
};

// utility: pack 3-bit values into bytes
const packTypeBits = (types: number[]) => {
    let bits = '';
    for (const t of types) bits += t.toString(2).padStart(3, '0');
    return bitsToBytes(bits);
};

// utility: unpack bytes into 3-bit type array
const unpackTypeBits = (bytes: Uint8Array, totalValues: number) => {
    const bitStr = bytesToBits(bytes);
    const types: number[] = [];
    for (let i = 0; i < totalValues; i++) {
        types.push(parseInt(bitStr.slice(i * 3, i * 3 + 3), 2));
    }
    return types;
};

// main compression
export const compressJSON = (value: any) => {
    const bools: boolean[] = [];
    const payload: number[] = [];
    const typeList: number[] = [];

    const encodeValue = (val: any) => {
        const type = val === null
            ? 'null'
            : Array.isArray(val)
                ? 'array'
                : typeof val;

        switch (type) {
            case 'null':
                typeList.push(JSONType.NULL);
                break;

            case 'boolean':
                typeList.push(JSONType.BOOL);
                bools.push(val);
                break;

            case 'number':
                if (Number.isInteger(val)) {
                    typeList.push(JSONType.INT);
                    payload.push(...convertVarInt(mapZigZag(val)));
                } else {
                    typeList.push(JSONType.FLOAT);
                    payload.push(...convertFloat(val));
                }
                break;

            case 'string':
                typeList.push(JSONType.STRING);
                payload.push(...encodeString(val));
                break;

            case 'array':
                typeList.push(JSONType.ARRAY);
                payload.push(...convertVarInt(val.length));

                for (const item of val) {
                    encodeValue(item);
                }
                break;

            case 'object': {
                typeList.push(JSONType.OBJECT);

                const keys = Object.keys(val);
                payload.push(...convertVarInt(keys.length));

                for (const key of keys) {
                    payload.push(...encodeString(key));
                    encodeValue(val[key]);
                }
                break;
            }

            default:
                throw new Error('Unsupported type');
        }
    };

    encodeValue(value);

    // boolean bitmap bytes
    const boolBytes = bools.length
        ? splitArray(bools, 8).map((slice: boolean[]) => compressBools(slice))
        : [];

    // type map bytes (3-bit per value)
    const typeBytes = packTypeBits(typeList);

    // prepend lengths of boolBytes and typeBytes as varints
    const header = [...convertVarInt(boolBytes.length), ...convertVarInt(typeBytes.length)];

    return Uint8Array.from([...header, ...boolBytes.flat(), ...typeBytes, ...payload]);
};

// decompression
export const decompressJSON = (bytes: Uint8Array) => {
    let offset = 0;

    // read lengths
    const [off1, boolByteLen] = readVarInt(bytes, offset);
    offset = off1;
    const [off2, typeByteLen] = readVarInt(bytes, offset);
    offset = off2;

    // boolean bitmap
    const boolStream: boolean[] = [];
    for (let i = 0; i < boolByteLen; i++) {
        boolStream.push(...decompressBools(bytes[offset++]));
    }
    let boolIndex = 0;

    // type map
    const typeBytes = bytes.subarray(offset, offset + typeByteLen);
    offset += typeByteLen;
    const typeList = unpackTypeBits(typeBytes, typeBytes.length * 8 / 3); // overestimate, will only use while decoding
    let typeIndex = 0;

    const decodeValue = (depth: number): any => {
        if(depth > 500) throw new Error("JSON array too deep.");
        const type = typeList[typeIndex++];
        switch (type) {
            case JSONType.NULL: return null;
            case JSONType.BOOL: return boolStream[boolIndex++];
            case JSONType.INT: {
                const [off, n] = readVarInt(bytes, offset);
                offset = off;
                return demapZigZag(n);
            }
            case JSONType.FLOAT: {
                const val = deconvertFloat(Array.from(bytes.subarray(offset, offset + 4)));
                offset += 4;
                return val;
            }
            case JSONType.STRING: {
                const { value, length } = decodeString(bytes, offset);
                offset += length;
                return value;
            }
            case JSONType.ARRAY: {
                const [off, len] = readVarInt(bytes, offset);
                offset = off;
                const arr = [];
                for (let i = 0; i < len; i++) arr.push(decodeValue(depth + 1));
                return arr;
            }
            case JSONType.OBJECT: {
                const [off, numKeys] = readVarInt(bytes, offset);
                offset = off;
                const obj: Record<string, any> = {};
                for (let i = 0; i < numKeys; i++) {
                    const { value: key, length: keyLen } = decodeString(bytes, offset);
                    offset += keyLen;
                    obj[key] = decodeValue(depth + 1);
                }
                return obj;
            }
            default:
                throw new Error(`Unknown type ${type}`);
        }
    };

    return decodeValue(0);
};
