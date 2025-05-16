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

// this shit is so complex so i commented it...

// char cache for easier code
export const NULL = String.fromCharCode(0), STX = String.fromCharCode(1), ETX = String.fromCharCode(2);

// the highest usable character in utf8
export const MAX_C = 55295;

// highest number INT_D can optimally support
export const MAX_INT_D = Number.MAX_SAFE_INTEGER;

// we split the usable range of code points in half to separate positive and negative encodings
export const NEGATIVE_C = Math.floor(MAX_C / 2);

// overflow is used as our "base" in a positional number system (like base 10, but very large)
// we use this to reduce the number of characters needed to represent large numbers
export const OVERFLOW = NEGATIVE_C + 1;

// precompute the overflow powers
const OVERFLOW_POWS: number[] = [];
function overflowPow(num: number): number {
    // ??= will set it if undefined or just return it
    return OVERFLOW_POWS[num] ??= Math.pow(OVERFLOW, num);
}
// precompute the 10^x powers
const TEN_POWS: number[] = [];
function tenPow(num: number) {
    // ??= will set it if undefined or just return it
    return TEN_POWS[num] ??= Math.pow(10, num);
}
// precompute 1-3
for(let i=1;i<=3;i++) {
    overflowPow(i);
    tenPow(i);
}

export function processCharCodes(text: string) {
    return Array.from(text, char => char.charCodeAt(0));
}

// this converts an encoded code point back to a signed number
export function fromSignedINT_C(point: number) {
    // if the code point is below NEGATIVE_C, it's a positive number and can be returned directly
    // if it's above or equal to NEGATIVE_C, it was originally negative, so we reverse the offset
    return point <= NEGATIVE_C ? point : -point + NEGATIVE_C;
}

// this converts a signed number into a non-negative integer that fits in a code point
export function toSignedINT_C(number: number) {
    // positive numbers are returned as-is
    // negative numbers are made positive and offset above NEGATIVE_C to mark them
    return number < 0 ? -number + NEGATIVE_C : number;
}

// just conversion and checks lol
export function stringedINT_C(number: number) {
    // no nan/infinity
    if(!isFinite(number)) throw new Error("Cannot use NaN or Infinity in INT_C");
    // limit check
    if (number > NEGATIVE_C || number < -NEGATIVE_C - 1) throw new Error(`INT_C Numbers must be within range -${NEGATIVE_C + 1} and ${NEGATIVE_C}`);
    // stringify the sign with checks, nice helper
    return String.fromCharCode(toSignedINT_C(number));
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
export function convertINT_D(number: number, chars: number) {
    // no nan/infinity
    if(!isFinite(number)) throw new Error("Cannot use a non-finite number in INT_E: " + number);
    // special case: zero is always encoded as a single null character
    if (number == 0) return NULL.repeat(chars);

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
    result.push(number % OVERFLOW);

    // if the number was negative, we offset each character to indicate the sign
    // we only offset non-zero digits to avoid collisions with the null character
    const stringified = negative ? result.map(part => String.fromCharCode(part > 0 ? part + NEGATIVE_C : part)).join("")
                                 : String.fromCharCode(...result);

    return stringified;
}

// decodes a string created by convertINT_D back into the original signed integer
export function deconvertINT_D(string: string) {
    return deconvertINT_DCodes(processCharCodes(string))
}
export function deconvertINT_DCodes(codes: number[]) {
    // for each code point in the string, reverse the sign encoding if necessary,
    // multiply by the positional weight based on its place (most-significant-digit first)
    return codes.reduce((c, n, i, arr) => c + fromSignedINT_C(n) * overflowPow(arr.length - i - 1), 0);
}

// boolean stuff
export const compressBools = (array: boolean[]) => array.reduce((byte: number, val: any, i: number) => byte | (val << (6 - i)), 0);
export const decompressBools = (byte: number) => [...Array(7)].map((_, i) => (byte & (1 << (6 - i))) !== 0);

// 512 to be safe
const SIGNED_EXP = 512;
// add signed for negative
function toSignedExp(exp: number) {
    return exp >= 0 ? exp : Math.abs(exp) + SIGNED_EXP;
}
// if above that, it's a negative, so turn it back
function fromSignedExp(exp: number) {
    return exp > SIGNED_EXP ? -(exp - SIGNED_EXP) : exp;
}

// converts numbers larger than Number.MAX_SAFE_INTEGER
export function convertINT_Es(numbers: number[]) {
    const scientificData = numbers.map(number => {
        // checks
        if(!isFinite(number)) throw new Error("Cannot use a non-finite number in INT_E: " + number);

        // 0 is simple
        if(number == 0) return [0, 0];

        // split the decimal and exponent of exponential,
        // + will be positive in Number(), and so - will be negative. simpler
        const [dec, exp] = number.toExponential().split("e").map(Number);
        // 𝑓𝑟𝑒𝑎𝑘𝑦 decimal remover to keep it integer
        const man = +String(dec).replace('.', '').substring(0, 15); // lose some precision but ensure it stays under MAX_SAFE_INTEGER

        // why are you looking at me bro idfk
        const manOff = (man < 0 ? 1 : 0);
        return [man, toSignedExp(exp) + (exp < 0 ? -manOff : manOff)];
    });

    const highestSectSize = scientificData.reduce((c, n) => Math.max(c, sectorSize(n[0])), 1) + 1;

    // one char for exp since it won't ever go above 1023,
    // and convert int d for the compressed part
    return String.fromCharCode(highestSectSize) + scientificData.map(([man, exp]) => String.fromCharCode(exp) + convertINT_D(man, highestSectSize)).join("");
}
// deconverts INT_E
export function deconvertINT_E(str: string) {
    // exponent is stored at char 0
    const exp = fromSignedExp(str.charCodeAt(0));
    // deconvert the rest
    const mantissa = deconvertINT_D(str.substring(1));

    // multiply by tenpow since it's E, and also subtract the length due to the decimal removal
    return mantissa * tenPow(exp - String(mantissa).length + 1);
}

// zig_zag
export function mapZIG_ZAG(n: number) {
    return (n << 1) // shifts left (multiply by 2 to get into zigzag)
           ^
           (n >> 15); // then xor the sign away
}
export function demapZIG_ZAG(n: number) {
    return (n >>> 1) // shifts right unsigned to remove the sign & divide by 2
           ^ 
           -(n & 1); // flips bits to give negative back
}

// byte size stuff for debugging
const encoder = new TextEncoder();
export function getCharBytes(char: string) {
    return encoder.encode(char).length;
}
export function getStringBytes(str: string) {
    return str.split("").reduce((c, n) => c + getCharBytes(n), 0);
}