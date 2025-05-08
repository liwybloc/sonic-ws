export const MAX_C = 0x10FFFF;
export const NEGATIVE_C = Math.floor(MAX_C / 2);
export const OVERFLOW = NEGATIVE_C + 1, LOG_OVERFLOW = Math.log(OVERFLOW);

export function processCodePoints(text: string): number[] {
    let points: number[] = [];
    const data: string[] = text.split("");

    for(let i=0;i<data.length;i++) {
        const codePoint: number | undefined = text.codePointAt(i);
        if(codePoint == undefined) throw new Error("Invalid string entered.");

        if(codePoint > 0xFFFF) i++; // Skip surrogate pair
        points.push(codePoint);
    }

    return points;
}

export function fromSignedINT_C(point: number): number {
    return point < NEGATIVE_C ? point : -point + NEGATIVE_C;
}
export function toSignedINT_C(number: number): number {
    return number < 0 ? -number + NEGATIVE_C : number;
}

export function convertINT_D(number: number): string {
    if(number == 0) return String.fromCodePoint(0);
    
    const chars = Math.floor(Math.log(number) / LOG_OVERFLOW) + 1;

    const negative = number < 0;
    number = Math.abs(number);

    let string = "";
    for(let i=0;i<chars-1;i++) string += String.fromCodePoint(Math.floor(number / Math.pow(OVERFLOW, chars - i - 1)));
    string += String.fromCodePoint(number % OVERFLOW);

    return negative ? processCodePoints(string).map(part => String.fromCodePoint(part > 0 ? part + NEGATIVE_C : part)).join("") : string;
}
export function deconvertINT_D(string: string): number {
    return processCodePoints(string).reduce((c, n, i, arr) => c + (n > NEGATIVE_C ? -(n - NEGATIVE_C) : n) * Math.pow(OVERFLOW, arr.length - i - 1), 0);
}