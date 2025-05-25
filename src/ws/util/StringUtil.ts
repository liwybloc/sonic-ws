/*
 * Copyright 2025 Lily (liwybloc)
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

export const SURROGATE_MIN = 0xD800, SURROGATE_MAX = 0xDFFF, MAX_UTF8 = 0xFFFF, MAX_UTF16 = 0x10FFFF;

export function processCharCodes(text: string): number[] {
    return Array.from(text, char => char.codePointAt(0)!);
}
export function convertCharCodes(codes: number[]): string {
    return String.fromCodePoint(...codes);
}

function isSurrogate(x: number): boolean {
    return x >= SURROGATE_MIN && x <= SURROGATE_MAX;
}

export function splitCodePoint(codePoint: number): number[] {
    if(codePoint <= MAX_UTF8) {
        if(isSurrogate(codePoint)) throw new Error(`Cannot send code point ${codePoint}; must be out of range ${SURROGATE_MIN} and ${SURROGATE_MAX}`);
        return [codePoint];
    }
    if(codePoint > MAX_UTF16) throw new Error(`Cannot send code ${codePoint}`);
    codePoint -= 0x10000;
    const highSurrogate = (codePoint >> 10) + 0xD800;
    const lowSurrogate = (codePoint & 0x3FF) + 0xDC00;
    return [highSurrogate, lowSurrogate];
}
export function pairToPoint(highSurrogate: number, lowSurrogate: number): number {
    return (highSurrogate - 0xD800) * 0x400 + (lowSurrogate - 0xDC00) + 0x10000;
}
export function convertCodePoints(codePoints: number[]): string {
    let result = [];
    for(let i=0;i<codePoints.length;i++) {
        const x = codePoints[i];
        if(isSurrogate(x)) {
            if(i == codePoints.length - 1) throw new Error(`Terminated surrogate pair; index ${i} value ${x}`);
            const pair = codePoints[++i];
            if(!isSurrogate(pair)) throw new Error(`Terminated surrogate pair; index ${i} value ${x} next value ${pair}`);
            result.push(pairToPoint(x, pair));
            continue;
        }
        result.push(x);
    }
    return convertCharCodes(result);
}