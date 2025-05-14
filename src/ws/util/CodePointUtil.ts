// this shit is so complex so i commented it...

// char cache for easier code
export const NULL = String.fromCharCode(0), STX = String.fromCharCode(1), ETX = String.fromCharCode(2);

// the highest usable character in utf8
export const MAX_C = 55295;

// we split the usable range of code points in half to separate positive and negative encodings
export const NEGATIVE_C = Math.floor(MAX_C / 2);

// overflow is used as our "base" in a positional number system (like base 10, but very large)
// we use this to reduce the number of characters needed to represent large numbers
export const OVERFLOW = NEGATIVE_C + 1;

const OVERFLOW_POWS: number[] = [];
function overflowPow(num: number): number {
    return OVERFLOW_POWS[num] ??= Math.pow(OVERFLOW, num);
}
for(let i=0;i<3;i++) overflowPow(i);

export function processCharCodes(text: string): number[] {
    return Array.from(text, char => char.charCodeAt(0));
}

// this converts an encoded code point back to a signed number
export function fromSignedINT_C(point: number): number {
    // if the code point is below NEGATIVE_C, it's a positive number and can be returned directly
    // if it's above or equal to NEGATIVE_C, it was originally negative, so we reverse the offset
    return point <= NEGATIVE_C ? point : -point + NEGATIVE_C;
}

// this converts a signed number into a non-negative integer that fits in a code point
export function toSignedINT_C(number: number): number {
    // positive numbers are returned as-is
    // negative numbers are made positive and offset above NEGATIVE_C to mark them
    return number < 0 ? -number + NEGATIVE_C : number;
}

// just conversion and checks lol
export function stringedINT_C(number: number): string {
    if(number > NEGATIVE_C || number < -NEGATIVE_C - 1) throw new Error(`INT_C Numbers must be within range -${NEGATIVE_C + 1} and ${NEGATIVE_C}`);
    return String.fromCharCode(toSignedINT_C(number));
}

// calculate how many characters (digits) are needed to store this number in OVERFLOW base
export function sectorSize(number: number): number {
    // 0 would make -Infinity;
    if(number == 0) return 1;

    number = Math.abs(number);
    
    // iterative system because it's faster than log
    let count = 1;
    let num = overflowPow(1);
    while(number >= num) {
        count++;
        num = overflowPow(count);
    }
    return count;
}

// encodes a signed integer into a unicode-safe string using a large base (OVERFLOW)
export function convertINT_D(number: number, chars: number): string {
    // special case: zero is always encoded as a single null character
    if (number == 0) return NULL;

    // store the sign and work with the absolute value
    const negative = number < 0;
    number = Math.abs(number);

    let result = [];

    // for each character except the last, extract the digit at that position
    // this is similar to how base conversion works: divide by base^position
    for (let i = 0; i < chars - 1; i++) {
        const power = overflowPow(chars - i - 1);
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
export function deconvertINT_D(string: string): number {
    return deconvertINT_DCodes(processCharCodes(string))
}
export function deconvertINT_DCodes(codes: number[]): number {
    // for each code point in the string, reverse the sign encoding if necessary,
    // then multiply by the appropriate base power based on its position
    return codes.reduce((c, n, i, arr) => {
        // multiply by the positional weight based on its place (most-significant-digit first)
        return c + fromSignedINT_C(n) * overflowPow(arr.length - i - 1);
    }, 0);
}

// boolean stuff
export const compressBools = (array: boolean[]) => array.reduce((byte: number, val: any, i: number) => byte | (val << (6 - i)), 0);
export const decompressBools = (byte: number) => [...Array(7)].map((_, i) => (byte & (1 << (6 - i))) !== 0);

// byte size stuff for debugging
const encoder = new TextEncoder();
export function getCharBytes(char: string) {
    return encoder.encode(char).length;
}
export function getStringBytes(str: string) {
    return str.split("").reduce((c, n) => c + getCharBytes(n), 0);
}