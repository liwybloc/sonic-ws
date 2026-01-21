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

import { bitsToBytes } from "./packets/CompressionUtil";

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