/*
 * Copyright 2025 Lily (cutelittlelily)
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

import { splitArray } from "../ArrayUtil";

// this shit is so complex so i commented it...

// char cache for easier code
export const NULL = String.fromCharCode(0), STX = String.fromCharCode(1), ETX = String.fromCharCode(2);

// the highest 8-bit
export const MAX_BYTE = 0xFF;
// we split the usable range in half to separate positive and negative encodings
export const NEGATIVE_BYTE = Math.floor(MAX_BYTE / 2);
// overflow is used as our "base" in a positional number system (like base 10, but very large)
// we use this to reduce the number of characters needed to represent large numbers
export const BYTE_OVERFLOW = NEGATIVE_BYTE + 1;

// the highest16-bit
export const MAX_SHORT = 0xFFFF;
// we split the usable range in half to separate positive and negative encodings
export const NEGATIVE_SHORT = Math.floor(MAX_SHORT / 2);
// overflow for shorts in construction
export const SHORT_OVERFLOW = MAX_BYTE + 1;

// highest number INT_D can optimally support
export const MAX_INT_D = Number.MAX_SAFE_INTEGER;


// precompute the overflow powers
const OVERFLOW_POWS: number[] = [];
export function overflowPow(num: number): number {
    // ??= will set it if undefined or just return it
    return OVERFLOW_POWS[num] ??= Math.pow(BYTE_OVERFLOW, num);
}
// precompute the 2^x powers
const TWO_POWS: number[] = [];
function twoPow(num: number) {
    // ??= will set it if undefined or just return it
    return TWO_POWS[num] ??= Math.pow(2, num);
}
// precompute 0-3
for(let i=0;i<=3;i++) {
    overflowPow(i);
    twoPow(i);
}

export function processCharCodes(text: string) {
    return Array.from(text, char => char.charCodeAt(0));
}

export type SHORT_BITS = [high: number, low: number];

// reconstruction
export function fromShort(short: SHORT_BITS) {
    // convert to number
    return short[0] * SHORT_OVERFLOW + short[1];
}
// checks, conversion
export function toShort(n: number, signed: boolean): SHORT_BITS {
    // no nan/infinity
    if(!isFinite(n)) throw new Error("Cannot use NaN or Infinity in shorts.");
    // limit check
    const lim = signed ? NEGATIVE_SHORT : MAX_SHORT;
    if (n > lim || n < -lim - 1) throw new Error(`${signed ? "Signed " : " "}Short Numbers must be within range -${lim + 1} and ${lim}`);
    // how many times it passes SHORT_OVERFLOW and the remainder
    return [Math.floor(n / SHORT_OVERFLOW), n % SHORT_OVERFLOW];
}

// this converts an encoded code point back to a signed number
export function fromSignedShort(short: SHORT_BITS) {
    // convert to number
    const point = fromShort(short);
    // if the number is below NEGATIVE_SHORT, it's a positive number and can be returned directly
    // if it's above or equal to NEGATIVE_SHORT, it was originally negative, so we reverse the offset
    return point <= NEGATIVE_SHORT ? point : -point + NEGATIVE_SHORT;
}
// this converts a signed number into a non-negative integer that fits in a short
export function toSignedShort(number: number): SHORT_BITS {
    // positive numbers are returned as-is
    // negative numbers are made positive and offset above NEGATIVE_SHORT to mark them
    // ugh fix this shit
    return toShort(number < 0 ? -number + NEGATIVE_SHORT : number, false);
}

// checks
export function toByte(n: number, signed: boolean): number {
    // no nan/infinity
    if(!isFinite(n)) throw new Error("Cannot use NaN or Infinity in bytes.");
    // limit check
    const lim = signed ? NEGATIVE_BYTE : MAX_BYTE;
    if (n > lim || n < -lim - 1) throw new Error(`${signed ? "Signed " : " "}Byte Numbers must be within range -${lim + 1} and ${lim}: ${n}`);
    return n;
}
// this converts a byte back to a signed number
export function fromSignedByte(point: number) {
    // if the number is below NEGATIVE_BYTE, it's a positive number and can be returned directly
    // if it's above or equal to NEGATIVE_BYTE, it was originally negative, so we reverse the offset
    return point <= NEGATIVE_BYTE ? point : -point + NEGATIVE_BYTE;
}
// this converts a signed number into a non-negative integer that fits in a byte
export function toSignedByte(number: number) {
    // positive numbers are returned as-is
    // negative numbers are made positive and offset above NEGATIVE_BYTE to mark them
    number = toByte(number, true);
    return number < 0 ? -number + NEGATIVE_BYTE : number;
}

// calculate how many characters (digits) are needed to store this number in OVERFLOW base
export function sectorSize(number: number) {
    number = Math.abs(number);

    // iterative system because it's faster than log
    let count = 1;
    // i like my code 𝑓𝑟𝑒𝑎𝑘𝑦
    for (let num = overflowPow(1); number >= num; num = overflowPow(++count));

    return count;
}

// encodes a signed integer into a unicode-safe string using a large base (OVERFLOW)
export function convertINT_DCodes(number: number, chars: number): number[] {
    // no nan/infinity
    if(!isFinite(number)) throw new Error("Cannot use a non-finite number in INT_E: " + number);
    // zero is just null
    if(number == 0) return Array.from({length: chars});
    // any 1 char will just be INT_C anyway
    if(chars == 1) return [toSignedByte(number)];

    // store the sign and work with the absolute value
    const negative = number < 0;
    number = Math.abs(number);

    // limit range
    if (number > MAX_INT_D) throw new Error(`INT_D Numbers must be within range -${MAX_INT_D.toLocaleString()} and ${MAX_INT_D.toLocaleString()}: ${number}`);

    let result = [];

    // for each character except the last, extract the digit at that position
    // this is similar to how base conversion works: divide by base^position
    const posPowerAmt = chars - 1;
    for (let i = 0; i < posPowerAmt; i++) {
        const power = overflowPow(posPowerAmt - i);
        const based = Math.floor(number / power);
        result.push(based);
        // remove it from the number so it doesnt effect future iterations
        number -= based * power;
    }

    // the last digit is just the remainder
    result.push(number % BYTE_OVERFLOW);

    // if the number was negative, we offset each character to indicate the sign
    // we only offset non-zero digits to avoid collisions with the null character
    const bits = negative ? result.map(part => part > 0 ? part + NEGATIVE_BYTE : part)
                            : result;

    return bits;
}

// encodes a signed integer into a unicode-safe string using a large base (OVERFLOW)
export function convertINT_D(number: number, chars: number): string {
    return String.fromCharCode(...convertINT_DCodes(number, chars));
}

// decodes a string created by convertINT_D back into the original signed integer
export function deconvertINT_DCodes(codes: any) {
    if(codes.length == 0) return fromSignedByte(codes[0]);
    // for each code point in the string, reverse the sign encoding if necessary,
    // multiply by the positional weight based on its place (most-significant-digit first)
    return codes.reduce((c: number, n: number, i: number, arr: any) => c + fromSignedByte(n) * overflowPow(arr.length - i - 1), 0);
}

// boolean stuff
export const compressBools = (array: boolean[]) => array.reduce((byte: number, val: any, i: number) => byte | (val << (7 - i)), 0);
export const decompressBools = (byte: number) => [...Array(8)].map((_, i) => (byte & (1 << (7 - i))) !== 0);

// IEEE-754 single-precision float codec

const MAN_BITS = 23;

function parseBin(str: string) {
    return Number("0b" + str);
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

function assembleFloat(sign: number, exponent: number, mantissa: number): number[] {
    const bin = sign.toString(2) + exponent.toString(2).padStart(8, "0") + mantissa.toString(2).padStart(23, "0");
    return splitArray(bin, 8).map((x: string) => parseBin(x));
}

// https://stackoverflow.com/questions/3096646/how-to-convert-a-floating-point-number-to-its-binary-representation-ieee-754-i
// edited for clarity
export function convertFloat(flt: number): number[] {
    if (isNaN(flt)) // Special case: NaN
        return assembleFloat(0, 0xFF, 0x1337); // Mantissa is nonzero for NaN

    const sign = (flt < 0) ? 1 : 0;
    flt = Math.abs(flt);
    if (flt == 0.0) // Special case: +-0
        return assembleFloat(sign, 0, 0);

    const exponent = Math.floor(Math.log(flt) / Math.LN2);
    if (exponent > 127 || exponent < -126) // Special case: +-Infinity (and huge numbers)
        return assembleFloat(sign, 0xFF, 0); // Mantissa is zero for +-Infinity

    const mantissa = flt / twoPow(exponent);
    const roundMan = Math.round((mantissa - 1) * twoPow(23));

    return assembleFloat(sign, exponent + 127, roundMan & 0x7FFFFF);
}

export function deconvertFloat(str: number[]) {
    const bin = str.map(x => x.toString(2).padStart(8, "0")).join("");
    const sign = parseBin(bin[0]);
    const rawExp = parseBin(bin.slice(1, 9));
    const exp = rawExp === 0 ? -126 : rawExp - 127;
    const man = parseMan(bin.slice(9, 32), rawExp !== 0); // whether to add the implicit 1
    return (sign == 0 ? 1 : -1) * man * twoPow(exp);
}

// zig_zag
export function mapZigZag(n: number) {
    return (n << 1) // shifts left (multiply by 2 to get into zigzag)
           ^
           (n >> 15); // then xor the sign away
}
export function demapZigZag(n: number) {
    return (n >>> 1) // shifts right unsigned to remove the sign & divide by 2
           ^ 
           -(n & 1); // flips bits to give negative back
}
export function demapShort_ZZ(short: SHORT_BITS) {
    return demapZigZag(fromShort(short));
}
export function mapShort_ZZ(short: number): SHORT_BITS {
    return toShort(mapZigZag(short), false);
}