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

import { splitArray } from "../ArrayUtil";

// this shit is so complex so i commented it...

// the highest 8-bit
export const MAX_BYTE = 0xFF;
// we split the usable range in half to separate positive and negative encodings
export const NEGATIVE_BYTE = Math.floor(MAX_BYTE / 2);
// overflow is used as our "base" in a positional number system (like base 10, but very large)
// we use this to reduce the number of characters needed to represent large numbers
export const BYTE_OVERFLOW = NEGATIVE_BYTE + 1;

// the highest 16-bit
export const MAX_SHORT = 0xFFFF;
// we split the usable range in half to separate positive and negative encodings
export const NEGATIVE_SHORT = Math.floor(MAX_SHORT / 2);
// overflow for shorts in construction
export const SHORT_CC_OVERFLOW = MAX_BYTE + 1;
// overflow for shorts base
export const SHORT_OVERFLOW = MAX_SHORT + 1;

// highest number INT_D can optimally support
export const MAX_INT_D = Number.MAX_SAFE_INTEGER;

// for varint to overflow; is 128
export const UVARINT_OVERFLOW = NEGATIVE_BYTE + 1;
// flag for chaining
export const VARINT_CHAIN_FLAG = 0x80;
// splitting usable range in half for signed
export const NEGATIVE_VARINT = Math.floor(NEGATIVE_BYTE / 2);
// for varint to overflow with negative; is 64
export const VARINT_OVERFLOW = NEGATIVE_VARINT + 1;
// max continues
export const MAX_VSECT_SIZE = 7;
// max value from this, subtract one for overflow
export const MAX_UVARINT = (UVARINT_OVERFLOW ** MAX_VSECT_SIZE) - 1;
// max for negatives
export const MAX_VARINT = Math.floor(MAX_UVARINT / 2);

// constants
export const ONE_EIGHT = 1/8;
export const ONE_FOURTH = 1/4;

// precompute powers
const VARINT_OVERFLOW_POWS: number[] = [];
export const varIntOverflowPow = (num: number) => VARINT_OVERFLOW_POWS[num] ??= UVARINT_OVERFLOW ** num;

const TWO_POWS: number[] = [];
const twoPow = (num: number) => TWO_POWS[num] ??= Math.pow(2, num);

for(let i = 0; i <= 3; i++) {
    varIntOverflowPow(i);
}

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

// calculate how many characters (digits) are needed to store this number in OVERFLOW base
export function sectorSize(number: number, pow: any) {
    number = Math.abs(number);

    // iterative system because it's faster than log
    let count = 1;
    // i like my code 𝑓𝑟𝑒𝑎𝑘𝑦
    for (let num = pow(1); number >= num; num = pow(++count));

    return count;
}

// encodes a number into a safe array using a large base (OVERFLOW)
export function convertBase(number: number, chars: number, neg: number, overflow: number, overflowFunc: any): number[] {
    // no nan/infinity
    if(!isFinite(number)) throw new Error("Cannot use a non-finite number: " + number);
    // zero is just null
    if(number == 0) return Array.from({length: chars}).map(() => 0);
    // any 1 char will just be INT_C anyway
    if(chars == 1) return [number];

    // store the sign and work with the absolute value
    const negative = number < 0;
    number = Math.abs(number);

    // limit range
    if (number > MAX_INT_D) throw new Error(`Non-float numbers must be within range -${MAX_INT_D.toLocaleString()} and ${MAX_INT_D.toLocaleString()}: ${number}`);

    let result = [];

    // for each character except the last, extract the digit at that position
    // this is similar to how base conversion works: divide by base^position
    const posPowerAmt = chars - 1;
    for (let i = 0; i < posPowerAmt; i++) {
        const power = overflowFunc(posPowerAmt - i);
        const based = Math.floor(number / power);
        result.push(based);
        // remove it from the number so it doesnt effect future iterations
        number -= based * power;
    }

    // the last digit is just the remainder
    result.push(number % overflow);

    // if the number was negative, we offset each character to indicate the sign
    // we only offset non-zero digits to avoid collisions with the null character
    const bits = negative ? result.map(part => part > 0 ? part + neg : part)
                            : result;

    return bits;
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
    return splitArray(bin, 8).map((x: string) => parseBin(x));
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

export function convertVarInt(num: number) {
    if(num > MAX_UVARINT || num < 0) throw new Error(`Variable Ints must be within range 0 and ${MAX_VARINT}: ${num}`);
    const chars = sectorSize(num, varIntOverflowPow);
    return convertBase(num, chars, VARINT_OVERFLOW, UVARINT_OVERFLOW, varIntOverflowPow).map((x, i) => i == 0 ? x : x | VARINT_CHAIN_FLAG).reverse();
}

export function readVarInt(arr: number[] | Uint8Array, off: number): [offset: number, number: number] {
    let num = [];
    let cont;
    do {
        const part = arr[off++];
        cont = (part & VARINT_CHAIN_FLAG) != 0;
        num.push(cont ? part ^ VARINT_CHAIN_FLAG : part);
    } while (cont);
    const number = num.reduce((p, c, i) => p + c * varIntOverflowPow(i), 0);
    return [off, number];
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

export function bytesToBits(bytes: ArrayLike<number>): string {
    return Array.from(bytes).map(b => b.toString(2).padStart(8, '0')).join('');
}
export function bitsToBytes(bitString: string): Uint8Array {
    const bytes = [];
    for (let i = 0; i < bitString.length; i += 8) {
        const byte = bitString.slice(i, i + 8).padEnd(8, '0');
        bytes.push(parseInt(byte, 2));
    }
    return new Uint8Array(bytes);
}

const codeToChar: Record<string, string> = {"1000001":"w","1000010":"m","1000100":"u","1000101":"c","1000110":"l","1000111":"d","1001001":"r","1001010":"h","1001100":"s","1001101":"n","1001110":"i","1001111":"o","1010001":"a","1010010":"t","1010100":"e","1010101":"","10000000":"","10000001":"","10000111":"","10010000":"","10010001":"","10010111":"","10100000":"","10100001":"","10100111":"","10101100":"","10101101":"~","10101111":"}","10110000":"|","10110001":"{","10110011":"`","10110100":"_","10110101":"^","10110111":"]","10111000":"","10111001":"[","10111011":"@","10111100":"?","10111101":">","10111111":"=","11000000":"<","11000001":";","11000011":":","11000100":"9","11000101":"8","11000111":"7","11001000":"6","11001001":"5","11001011":"4","11001100":"3","11001101":"2","11001111":"1","11010000":"0","11010001":"/","11010011":".","11010100":"-","11010101":",","11010111":"+","11011000":"*","11011001":")","11011011":"(","11011100":"'","11011101":"&","11011111":"$","11100001":"#","11100010":"\"","11100100":"!","11100101":"\u001f","11100110":"\u001e","11100111":"\u001d","11101001":"\u001c","11101010":"\u001b","11101100":"\u001a","11101101":"\u0019","11101110":"\u0018","11101111":"\u0017","11110001":"\u0016","11110010":"\u0015","11110100":"\u0014","11110101":"\u0013","11110110":"\u0012","11110111":"\u0011","11111001":"\u0010","11111010":"\u000f","11111100":"\u000e","11111101":"","11111110":"","11111111":"","100001100":"Ã","100101100":"Â","100101101":"Á","101001100":"À","101011100":"¿","101011101":"¾","101100100":"½","101101100":"¼","101101101":"»","101110100":"º","101111100":"¹","101111101":"¸","110000100":"·","110001100":"¶","110001101":"µ","110010100":"´","110011100":"³","110011101":"²","110100100":"±","110101100":"°","110101101":"¯","110110100":"®","110111100":"­","110111101":"%","111000000":"¬","111000001":"«","111000111":"ª","111010000":"©","111010001":"¨","111010111":"§","111100000":"¦","111100001":"¥","111100111":"¤","111110000":"£","111110001":"¢","111110111":"¡","1000011010":"á","1010011010":"à","1010011011":"ß","1011001010":"Þ","1011101010":"Ý","1011101011":"Ü","1100001010":"Û","1100101010":"Ú","1100101011":"Ù","1101001010":"Ø","1101101010":"×","1101101011":"Ö","1110001100":"Õ","1110101100":"Ô","1110101101":"Ó","1111001100":"Ò","1111101100":"Ñ","1111101101":"Ð","00000000":" ","00000001":"","0000001":"\n","0000010":"","000001100":"Ï","0000011010":"ç","00000110110":"ó","000001101110":"ù","0000011011110":"ü","00000110111110":"þ","00000110111111":"ý","00000111":"","0000100":"\b","0000101":"\u0007","0000110":"\u0006","0000111":"\u0005","00010000":"","00010001":"","0001001":"\u0004","0001010":"\u0003","000101100":"Î","000101101":"Í","00010111":"","0001100":"\u0002","0001101":"\u0001","0001110":"","0001111":"Z","00100000":"","00100001":"","0010001":"Q","0010010":"X","001001100":"Ì","0010011010":"æ","0010011011":"å","00100111":"","0010100":"J","0010101":"K","0010110":"V","0010111":"B","00110000":"","00110001":"","0011001":"P","0011010":"Y","001101100":"Ë","001101101":"Ê","00110111":"","0011100":"G","0011101":"F","0011110":"W","0011111":"M","01000000":"","01000001":"","0100001":"U","0100010":"C","010001100":"É","0100011010":"ä","01000110110":"ò","01000110111":"ñ","01000111":"","0100100":"L","0100101":"D","0100110":"R","0100111":"H","01010000":"","01010001":"","0101001":"S","0101010":"N","010101100":"È","010101101":"Ç","01010111":"","0101100":"I","0101101":"O","0101110":"A","0101111":"T","01100000":"","01100001":"","0110001":"E","0110010":"z","011001100":"Æ","0110011010":"ã","0110011011":"â","01100111":"","0110100":"q","0110101":"x","0110110":"j","0110111":"k","01110000":"","01110001":"","0111001":"v","0111010":"b","011101100":"Å","011101101":"Ä","01110111":"","0111100":"p","0111101":"y","0111110":"g","0111111":"f","10000110110":"ð","100001101110":"ø","100001101111":"÷","10110010110":"ï","10110010111":"î","11000010110":"í","110000101110":"ö","1100001011110":"û","1100001011111":"ú","11010010110":"ì","11010010111":"ë","11100011010":"ê","111000110110":"õ","111000110111":"ô","11110011010":"é","11110011011":"è"};
const charToCode: Record<string, string> = Object.fromEntries(Object.entries(codeToChar).map(([code, char]) => [char, code]));

export function encodeHuffman(text: string): Uint8Array {
    return bitsToBytes(Array.from(text).map(char => charToCode[char]).join(""));
};

export function decodeHuffman(bits: string): string {
    let result = '';
    let buffer = '';
    for (const bit of bits) {
        buffer += bit;
        if (codeToChar[buffer]) {
            result += codeToChar[buffer];
            buffer = '';
        }
    }
    return result;
};