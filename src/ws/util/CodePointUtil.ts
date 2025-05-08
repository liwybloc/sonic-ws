// this shit is so complex so i commented it...

// null char so it's easy
export const NULL = String.fromCharCode(0);

// the highest usable character in utf8
export const MAX_C = 55295;

// we split the usable range of code points in half to separate positive and negative encodings
export const NEGATIVE_C = Math.floor(MAX_C / 2);

// overflow is used as our "base" in a positional number system (like base 10, but very large)
// we use this to reduce the number of characters needed to represent large numbers
export const OVERFLOW = NEGATIVE_C + 1;

// precomputed log(OVERFLOW) lets us calculate how many digits (characters) we need
export const LOG_OVERFLOW = Math.log(OVERFLOW);

export function processCharCodes(text: string): number[] {
    return text.split("").map(v => v.charCodeAt(0));
}

// this converts an encoded code point back to a signed number
export function fromSignedINT_C(point: number): number {
    // if the code point is below NEGATIVE_C, it's a positive number and can be returned directly
    // if it's above or equal to NEGATIVE_C, it was originally negative, so we reverse the offset
    return point < NEGATIVE_C ? point : -point + NEGATIVE_C;
}

// this converts a signed number into a non-negative integer that fits in a code point
export function toSignedINT_C(number: number): number {
    // positive numbers are returned as-is
    // negative numbers are made positive and offset above NEGATIVE_C to mark them
    return number < 0 ? -number + NEGATIVE_C : number;
}

// just conversion and checks lol
export function stringedINT_C(number: number): string {
    if(number >= NEGATIVE_C || number < -NEGATIVE_C - 1) throw new Error(`INT_C Numbers must be within range -${NEGATIVE_C + 1} and ${NEGATIVE_C}`);
    return String.fromCharCode(toSignedINT_C(number));
}

// calculate how many characters (digits) are needed to store this number in OVERFLOW base
export function sectorSize(number: number): number {
    // 0 would make -Infinity;
    if(number == 0) return 1;
    // we add 1 because log gives us a fractional digit count that needs to be rounded up
    return Math.floor(Math.log(Math.abs(number)) / LOG_OVERFLOW) + 1;
}

// encodes a signed integer into a unicode-safe string using a large base (OVERFLOW)
export function convertINT_D(number: number, chars: number): string {
    // special case: zero is always encoded as a single null character
    if (number == 0) return NULL;

    // store the sign and work with the absolute value
    const negative = number < 0;
    number = Math.abs(number);

    let string = "";

    // for each character except the last, extract the digit at that position
    // this is similar to how base conversion works: divide by base^position
    for (let i = 0; i < chars - 1; i++) {
        const power = Math.pow(OVERFLOW, chars - i - 1);
        const based = Math.floor(number / power);
        string += String.fromCharCode(based);
        // remove it from the number so it doesnt effect future iterations
        number -= based * power;
    }

    // the last digit is just the remainder
    string += String.fromCharCode(number % OVERFLOW);

    // if the number was negative, we offset each character to indicate the sign
    // we only offset non-zero digits to avoid collisions with the null character
    const stringified = negative ? processCharCodes(string)
                                    .map(part => String.fromCharCode(part > 0 ? part + NEGATIVE_C : part))
                                    .join("")
                                 : string;
    
    return stringified;
}

// decodes a string created by convertINT_D back into the original signed integer
export function deconvertINT_D(string: string): number {
    // for each code point in the string, reverse the sign encoding if necessary,
    // then multiply by the appropriate base power based on its position
    return processCharCodes(string).reduce((c, n, i, arr) => {
        // multiply by the positional weight based on its place (most-significant-digit first)
        return c + fromSignedINT_C(n) * Math.pow(OVERFLOW, arr.length - i - 1);
    }, 0);
}