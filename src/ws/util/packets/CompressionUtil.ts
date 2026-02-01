/*
 * Copyright 2026 Lily (liwybloc)
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { splitArray } from "../BufferUtil";

// this shit is so complex so i commented it...

// the highest 8-bit
export const MAX_BYTE = 0xFF;
// we split the usable range in half to separate positive and negative encodings
export const NEGATIVE_BYTE = 0x7F;
// the highest 16-bit
export const MAX_SHORT = 0xFFFF;
// overflow for shorts in construction
export const SHORT_CC_OVERFLOW = MAX_BYTE + 1;

// for varint to overflow; is 128
export const UVARINT_OVERFLOW = NEGATIVE_BYTE + 1,
             VARINT_CHAIN_FLAG = 0x80,                               // flag for chaining
             NEGATIVE_VARINT = Math.floor(NEGATIVE_BYTE / 2),        // splitting usable range in half for signed
             VARINT_OVERFLOW = NEGATIVE_VARINT + 1,                  // for varint to overflow with negative; is 64
             MAX_VSECT_SIZE = 7,                                     // max continues
             MAX_UVARINT = (UVARINT_OVERFLOW ** MAX_VSECT_SIZE) - 1, // max value from this, subtract one for overflow
             MAX_VARINT = Math.floor(MAX_UVARINT / 2);               // max for negatives

// constants
export const ONE_EIGHT = 1/8, ONE_FOURTH = 1/4;
export const EMPTY_UINT8 = new Uint8Array([]);

const TWO_POWS: number[] = [];
const twoPow = (num: number) => TWO_POWS[num] ??= Math.pow(2, num);

export type SHORT_BITS = [high: number, low: number];

// reconstruction
export function fromShort(short: SHORT_BITS) {
    // convert to number
    return short[0] * SHORT_CC_OVERFLOW + short[1];
}
// checks, conversion
export function toShort(n: number): SHORT_BITS {
    // no nan/infinity
    if(!isFinite(n)) throw new Error("Can only use real numbers in shorts: " + n);
    // limit check
    if (n > MAX_SHORT || n < 0) throw new Error(`Short Numbers must be within range 0 and ${MAX_SHORT}`);

    // how many times it passes SHORT_OVERFLOW and the remainder
    return [Math.floor(n / SHORT_CC_OVERFLOW), n % SHORT_CC_OVERFLOW];
}

// checks
export function toByte(n: number): number {
    // no nan/infinity
    if(!isFinite(n)) throw new Error("Can only use real numbers in bytes: " + n);;
    // limit check
    if (n > MAX_BYTE || n < -MAX_BYTE - 1) throw new Error(`Byte Numbers must be within range -${MAX_BYTE + 1} and ${MAX_BYTE}: ${n}`);
    return n;
}

// boolean stuff
export const compressBools = (array: boolean[]) => array.reduce((byte: number, val: any, i: number) => byte | (val << (7 - i)), 0);
export const decompressBools = (byte: number) => [...Array(8)].map((_, i) => (byte & (1 << (7 - i))) !== 0);

// IEEE-754 single-precision float codec

const MAN_BITS = 23;

function parseBin(str: string) {
    return parseInt(str, 2);
}

function parseMan(bin: string, isNormal: boolean) {
    const mantissaInt = parseBin(bin);

    let fraction = 0;
    for (let i = 0; i < MAN_BITS; i++) {
        if (mantissaInt & (1 << (MAN_BITS - i - 1))) {
            fraction += twoPow(-(i + 1));
        }
    }
    return (isNormal ? 1 : 0) + fraction;
}

// constants for floating point numbers
const FLOAT_EXPSIZE = 8, FLOAT_FRACTSIZE = 23;
const DOUBLE_EXPSIZE = 11, DOUBLE_FRACTSIZE = 52;

const FLOAT_SPECIAL = 0xFF, DOUBLE_SPECIAL = 0x7FF;

// assembles floating point values into 4 bytes
function assembleFloatingPoint(expSize: number, fractSize: number, sign: number, exponent: number, mantissa: number) {
    const bin = sign.toString(2) + exponent.toString(2).padStart(expSize, "0") + mantissa.toString(2).padStart(fractSize, "0");
    return splitArray(Array.from(bin), 8).map((x: string[]) => parseBin(x.join("")));
}

function assembleSingleFloat(sign: number, exponent: number, mantissa: number) {
    return assembleFloatingPoint(FLOAT_EXPSIZE, FLOAT_FRACTSIZE, sign, exponent, mantissa);
}
function assembleDoubleFloat(sign: number, exponent: number, mantissa: number) {
    return assembleFloatingPoint(DOUBLE_EXPSIZE, DOUBLE_FRACTSIZE, sign, exponent, mantissa);
}

// https://stackoverflow.com/questions/3096646/how-to-convert-a-floating-point-number-to-its-binary-representation-ieee-754-i
// edited for clarity
export function convertFloat(flt: number){
    if (isNaN(flt)) // Special case: NaN
        return assembleSingleFloat(0, FLOAT_SPECIAL, 1); // Mantissa is nonzero for NaN

    const sign = (flt < 0) ? 1 : 0;
    flt = Math.abs(flt);
    if (flt == 0.0) // Special case: +-0
        return assembleSingleFloat(sign, 0, 0);

    const exponent = Math.floor(Math.log(flt) / Math.LN2);
    if (exponent > 127 || exponent < -126) // Special case: +-Infinity (and huge numbers)
        return assembleSingleFloat(sign, 0xFF, 0); // Mantissa is zero for +-Infinity

    const mantissa = flt / twoPow(exponent);
    const roundMan = Math.round((mantissa - 1) * twoPow(23));

    return assembleSingleFloat(sign, exponent + 127, roundMan & 0x7FFFFF);
}

export function deconvertFloat(bytes: number[]) {
    const bin = bytes.map(x => x.toString(2).padStart(8, "0")).join("");

    // bit 1 = sign
    // bits 2-9 = exponent
    // bits 10-32 = mantissa
    const sign = parseBin(bin[0]);
    const rawExp = parseBin(bin.slice(1, 9));
    const exp = rawExp == 0 ? -126 : rawExp - 127;
    const man = parseMan(bin.slice(9, 32), rawExp != 0); // whether to add the implicit 1

    let result;
    if(rawExp == FLOAT_SPECIAL) {
        result = man == 0 ? Infinity : NaN;
    } else {
        result = man * twoPow(exp);
    }

    return sign == 1 ? -result : result;
}

// https://stackoverflow.com/questions/72659156/convert-double-to-integer-mantissa-and-exponents
// turned to javascript
export function convertDouble(double: number) {
    if(isNaN(double)) return assembleDoubleFloat(0, DOUBLE_SPECIAL, 1); // nonzero for nan. sign doesnt effect anything

    const sign = double < 0 ? 1 : 0;
    if(!isFinite(double)) return assembleDoubleFloat(sign, DOUBLE_SPECIAL, 0); // zero for infinity

    double = Math.abs(double);

    let exponent, significand;
    if (double == 0) {
        exponent = 0;
        significand = 0;
    } else {
        exponent = Math.floor(Math.log2(double)) - 51;
        significand = Math.floor(double / twoPow(exponent));
    }
    return assembleDoubleFloat(sign, exponent + 1023, significand);
}

export function deconvertDouble(bytes: number[]) {
    const bin = bytes.map(x => x.toString(2).padStart(8, "0")).join("");

    // bit 1 = sign
    // bits 2-12 = exponent
    // bits 13-64 = mantissa
    const sign = parseBin(bin[0]);
    const rawExp = parseBin(bin.slice(1, 12));
    const exp = rawExp == 0 ? -1022 : rawExp - 1023;
    const man = parseBin(bin.slice(12, 64));

    let result;
    if(rawExp == DOUBLE_SPECIAL) {
        result = man == 0 ? Infinity : NaN;
    } else {
        result = man * twoPow(exp);
    }

    return sign == 1 ? -result : result;
}

// zig_zag
export function mapZigZag(n: number) {
    return ((n << 1) ^ (n >> 31));
}
export function demapZigZag(n: number) {
    return (n >>> 1) ^ -((n & 1));
}
export function demapShort_ZZ(short: SHORT_BITS) {
    return demapZigZag(fromShort(short));
}
export function mapShort_ZZ(short: number): SHORT_BITS {
    return toShort(mapZigZag(short));
}

// yeah!

export function convertVarInt(num: number): number[] {
    if (num > MAX_UVARINT || num < 0) 
        throw new Error(`Variable Ints must be within range 0 and ${MAX_VARINT}: ${num}`);
    if (num === 0) return [0];

    const result: number[] = [];
    while (num > 0) {
        let byte = num & 0x7F; // take 7 bits
        num >>>= 7;
        if (num > 0) byte |= VARINT_CHAIN_FLAG;
        result.push(byte);
    }
    return result;
}

export function readVarInt(arr: number[] | Uint8Array, off: number): [number, number] {
    let num = 0;
    let shift = 0;
    let byte: number;

    do {
        byte = arr[off++];
        num += (byte & ~VARINT_CHAIN_FLAG) << shift;
        shift += 7;
    } while ((byte & VARINT_CHAIN_FLAG) !== 0);

    return [off, num];
}

export function deconvertVarInts(arr: Uint8Array | number[]): number[] {
    let res = [];
    let i = 0;
    while(i < arr.length) {
        const [off, varint] = readVarInt(arr, i);
        res.push(varint);
        i = off;
    }
    return res;
}

export const bytesToBits = (bytes: ArrayLike<number>) =>
    Array.from(bytes).map(b => b.toString(2).padStart(8, '0')).join('');

export const bitsToBytes = (bits: string) =>
    new Uint8Array(bits.match(/.{1,8}/g)?.map(b => parseInt(b.padEnd(8, '0'), 2)) ?? []);

const gzipError = "Your browser is too old to support compression. Please update!";
export async function compressGzip(data: Uint8Array<ArrayBuffer>, ident: string = ""): Promise<Uint8Array> {
    if (typeof CompressionStream === "undefined") {
        if (typeof window !== "undefined") window.alert(gzipError);
        throw new Error(gzipError);
    }

    const stream = new Blob([data]).stream().pipeThrough(new CompressionStream("deflate-raw"));
    const buffer = await new Response(stream).arrayBuffer();
    if(data.length <= buffer.byteLength && ident != "") {
        console.warn("WARN: Packet '" + ident + "' is small, and compressing it makes the size bigger!");
    }
    return new Uint8Array(buffer);
}

export async function decompressGzip(data: Uint8Array): Promise<Uint8Array> {
    if (typeof DecompressionStream === "undefined") {
        if (typeof window !== "undefined") window.alert(gzipError);
        throw new Error(gzipError);
    }

    const stream = new Blob([data as unknown as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
    const buffer = await new Response(stream).arrayBuffer();
    return new Uint8Array(buffer);
}

export function bytesToHex(bytes: Uint8Array) {
    return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
};
export function hexToBytes(hex: string) {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < hex.length; i += 2) {
        bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
    }
    return bytes;
};