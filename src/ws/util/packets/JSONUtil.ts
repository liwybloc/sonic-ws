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
import { convertVarInt, readVarInt, bitsToBytes, bytesToBits, mapZigZag, convertFloat, compressBools, decompressBools, demapZigZag, deconvertFloat } from "./CompressionUtil";

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
        if (val === null) {
            typeList.push(JSONType.NULL);
        } else if (typeof val === 'boolean') {
            typeList.push(JSONType.BOOL);
            bools.push(val);
        } else if (Number.isInteger(val)) {
            typeList.push(JSONType.INT);
            payload.push(...convertVarInt(mapZigZag(val)));
        } else if (typeof val === 'number') {
            typeList.push(JSONType.FLOAT);
            payload.push(...convertFloat(val));
        } else if (typeof val === 'string') {
            typeList.push(JSONType.STRING);
            payload.push(...encodeString(val));
        } else if (Array.isArray(val)) {
            typeList.push(JSONType.ARRAY);
            payload.push(...convertVarInt(val.length));
            for (const item of val) encodeValue(item);
        } else if (typeof val === 'object') {
            typeList.push(JSONType.OBJECT);
            const keys = Object.keys(val);
            payload.push(...convertVarInt(keys.length));
            for (const key of keys) {
                payload.push(...encodeString(key));
                encodeValue(val[key]);
            }
        } else {
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
