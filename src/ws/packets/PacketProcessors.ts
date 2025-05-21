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

import { EnumPackage, EnumValue } from "../util/enums/EnumType";
import { splitArray } from "../util/ArrayUtil";
import { compressBools, convertFloat, convertBytePows, decompressBools, deconvertFloat, deconvertBytePows, demapShort_ZZ, demapZigZag, fromShort, fromSignedByte, fromSignedShort, mapShort_ZZ, mapZigZag, byteOverflowPow, processCharCodes, sectorSize, SHORT_BITS, toByte, toShort, toSignedByte, toSignedShort, MAX_DSECT_SIZE, convertVarInt, deconvertVarInts, VARINT_CHAIN_FLAG, MAX_VSECT_SIZE, MAX_BYTE } from "../util/packets/CompressionUtil";
import { Packet } from "./Packets";
import { PacketType } from "./PacketType";
import { splitBuffer } from "../util/BufferUtil";

const BYTE_LEN = (data: Uint8Array, cap: number, min: number) => data.length >= min && data.length <= cap;
const SHORT_LEN = (data: Uint8Array, cap: number, min: number) => data.length >= min * 2 && data.length <= cap * 2 && data.length % 2 == 0;

const VARINT_VERIF = (raw: Uint8Array, cap: number, min: number) => {
    if(raw.length == 0) return false;

    let sectors = 0;
    let i = 0;
    while(i < raw.length) {
        let cont = false, inSect = 0;
        do {
            if(++inSect > MAX_VSECT_SIZE) return false;
            cont = (raw[i++] & VARINT_CHAIN_FLAG) != 0;
        } while (cont);
        if(++sectors > cap) return false;
    }
    if(sectors < min) return false;

    return true;
};

// todo, instead of big array make this a function that creates functions, then i can include pre-defined data like Math.floor(min/8) and stuff
export const PacketValidityProcessors: Record<PacketType, (data: Uint8Array, dataCap: number, dataMin: number, packet: Packet, index: number) => boolean> = {
    [PacketType.NONE]: (data) => data.length == 0,
    [PacketType.RAW]: () => true,

    [PacketType.STRINGS_UTF8]: (data: Uint8Array, cap: number, min: number) => {
        let sectors = 0;
        for(let index = 0; index < data.length; index++) {
            sectors++;
            if(sectors > cap) return false;
            index += data[index];
            if(index + 1 > data.length) return false;
        }
        if(sectors < min) return false;
        return true;
    },
    // todo
    [PacketType.STRINGS_UTF16]: (data: Uint8Array, cap: number, min: number) => true,

    [PacketType.ENUMS]: (data, cap, min, packet, index) => {
        if (data.length < min || data.length > cap || index >= packet.enumData.length) return false;
        
        const pkg = packet.enumData[index];
        for(let i=0;i<data.length;i++) {
            if(pkg.values.length <= data[i]) return false;
        }

        return true;
    },

    [PacketType.BYTES]: BYTE_LEN,
    [PacketType.UBYTES]: BYTE_LEN,
    [PacketType.BYTES_ZZ]: BYTE_LEN,

    [PacketType.SHORTS]: SHORT_LEN,
    [PacketType.USHORTS]: SHORT_LEN,
    [PacketType.SHORTS_ZZ]: SHORT_LEN,

    [PacketType.NUMBERS]: (raw: Uint8Array, cap: number, min: number) => {
        if(raw.length == 0) return false;

        const sectSize = raw[0];
        if(sectSize > MAX_DSECT_SIZE) return false;

        const dataLength = raw.length - 1;
        if(dataLength % sectSize != 0) return false;

        const valueAmount = dataLength / sectSize;
        if(valueAmount < min || valueAmount > cap) return false;

        return true;
    },

    [PacketType.VARINT]: VARINT_VERIF,
    [PacketType.UVARINT]: VARINT_VERIF,
    [PacketType.VARINT_ZZ]: VARINT_VERIF,
    
    [PacketType.FLOAT]: (data, cap, min) => {
        let sectors = 0;
        for(let i=0;i<data.length;i+=4) {
            if(i + 4 > data.length) return false;
            sectors++;
            if(sectors > cap) return false;
        }
        if(sectors < min) return false;
        return true;
    },

    [PacketType.BOOLEANS]: (data, cap, min) => {
        return data.length >= Math.floor(min / 8) && data.length <= Math.floor(cap / 8) && data.find(d => d > 255) == undefined;
    }
}

export const PacketReceiveProcessors: Record<PacketType, (data: Uint8Array, cap: number, packet: Packet, index: number) => Uint8Array | string | number | number[] | string[] | EnumValue[]> = {
    [PacketType.NONE]: () => "",
    [PacketType.RAW]: (data) => data,

    [PacketType.STRINGS_UTF8]: (data) => {
        let strings: string[] = [];
        for(let i = 0; i < data.length; i++) {
            const stringSize = data[i];
            const str = Array.from(data.slice(i + 1, i + 1 + stringSize));
            strings.push(str.map(x => String.fromCharCode(x)).join(""));
            i += stringSize;
        }
        return strings;
    },
    [PacketType.STRINGS_UTF16]: (data) => {
        let strings: string[] = [];
        for(let i = 0; i < data.length; i++) {
            const stringSize = data[i] * 2;
            strings.push(splitBuffer(data.slice(i + 1, i + 1 + stringSize), 2).map((short: number[]) => String.fromCharCode(fromShort(short as SHORT_BITS))).join(""));
            i += stringSize;
        }
        return strings;
    },

    [PacketType.ENUMS]: (data, _, packet, index) => {
        const pkg: EnumPackage = packet.enumData[index];
        return Array.from(data).map(code => pkg.values[code]);
    },

    [PacketType.BYTES]: (data) => Array.from(data).map(fromSignedByte),
    [PacketType.UBYTES]: (data) => Array.from(data),
    [PacketType.BYTES_ZZ]: (data) => Array.from(data).map(demapZigZag),

    [PacketType.SHORTS]: (data) => splitBuffer(data, 2).map(v => fromSignedShort(v as SHORT_BITS)),
    [PacketType.USHORTS]: (data) => splitBuffer(data, 2).map(v => fromShort(v as SHORT_BITS)),
    [PacketType.SHORTS_ZZ]: (data) => splitBuffer(data, 2).map(v => demapShort_ZZ(v as SHORT_BITS)),

    [PacketType.NUMBERS]: (data) => splitArray(data.slice(1), data[0]).map(deconvertBytePows),

    [PacketType.VARINT]: (data) => deconvertVarInts(Array.from(data), true),
    [PacketType.UVARINT]: (data) => deconvertVarInts(Array.from(data), false),
    [PacketType.VARINT_ZZ]: (data) => deconvertVarInts(Array.from(data), false).map(demapZigZag),

    [PacketType.FLOAT]: (data) => splitBuffer(data, 4).map(deconvertFloat),

    [PacketType.BOOLEANS]: (data, cap) => Array.from(data).map(d => decompressBools(d)).flat().splice(0, cap),
};

export const PacketSendProcessors: Record<PacketType, (...data: any) => number[]> = {
    [PacketType.NONE]: () => [],
    [PacketType.RAW]: (data: any[]) => data.map(s => processCharCodes(String(s))).flat(),

    [PacketType.STRINGS_UTF8]: (strings: any[]) => {
        const res: number[] = [];
        for(const v of strings) {
            const string = String(v);
            res.push(string.length);

            const codes = processCharCodes(string);

            const highCode = codes.find(x => x > MAX_BYTE)
            if(highCode) throw new Error(`Cannot store code ${highCode} (${String.fromCharCode(highCode)}) in a UTF-8 String! Use STRINGS_UTF16.`);

            codes.map(c => res.push(c));
        }
        return res;
    },
    [PacketType.STRINGS_UTF16]: (strings: any[]) => {
        const res: number[] = [];
        for(const v of strings) {
            const string = String(v);
            res.push(string.length);
            processCharCodes(string).map(c => res.push(...toShort(c, false)));
        }
        return res;
    },

    [PacketType.ENUMS]: (enums: number[]) => enums,

    [PacketType.BYTES]: (numbers: number[]) => numbers.map(toSignedByte),
    [PacketType.UBYTES]: (numbers: number[]) => numbers.map(n => toByte(n, false)),
    [PacketType.BYTES_ZZ]: (numbers: number[]) => numbers.map(mapZigZag),

    [PacketType.SHORTS]: (numbers: number[]) => numbers.map(toSignedShort).flat(),
    [PacketType.USHORTS]: (numbers: number[]) => numbers.map(n => toShort(n, false)).flat(),
    [PacketType.SHORTS_ZZ]: (numbers: number[]) => numbers.map(mapShort_ZZ).flat(),

    [PacketType.NUMBERS]: (numbers: number[]) => {
        const res: number[] = [];
        const sectSize = numbers.reduce((c, n) => Math.max(c, sectorSize(n, byteOverflowPow)), 1);
        res.push(sectSize);
        numbers.forEach(n => convertBytePows(n, sectSize).forEach(c => res.push(c)));
        return res;
    },

    [PacketType.VARINT]: (numbers: number[]) => numbers.map(n => convertVarInt(n, true)).flat(),
    [PacketType.UVARINT]: (numbers: number[]) => numbers.map(n => convertVarInt(n, false)).flat(),
    [PacketType.VARINT_ZZ]: (numbers: number[]) => numbers.map(n => convertVarInt(mapZigZag(n), false)).flat(),

    [PacketType.FLOAT]: (floats: number[]) => floats.map(convertFloat).flat(),
    
    [PacketType.BOOLEANS]: (bools: boolean[]) => splitArray(bools, 8).map((bools: boolean[]) => compressBools(bools)).flat(),
}

// so uhm. it work. sorry-
export function createObjSendProcessor(types: PacketType[], packetDelimitSize: number): (data: any[]) => number[] {
    const size = types.length;
    const processors = types.map(t => PacketSendProcessors[t]);
    const lim = byteOverflowPow(packetDelimitSize);
    return (data: any[]) => {
        let result: number[] = [];
        for(let i=0;i<size;i++) {
            const sectorData = data[i];
            const d = processors[i](Array.isArray(sectorData) ? sectorData : [sectorData]);
            if(d.length > lim) throw new Error(`Cannot store ${d.length}/${lim} bytes of data! Increase packetSize on the object!`);
            result.push(...convertBytePows(d.length, packetDelimitSize));
            d.forEach(val => result.push(val));
        }
        return result;
    };
}
export function createObjReceiveProcessor(types: PacketType[], packetDelimitSize: number): (data: Uint8Array, dataCaps: number[], packet: Packet) => any {
    const processors = types.map(t => PacketReceiveProcessors[t]);
    return (data: Uint8Array, dataCaps: number[], packet: Packet) => {
        let result: any[] = [];
        let enums = 0;
        for(let i=0;i<data.length;) {
            const sectorLength = deconvertBytePows(data.slice(i, i += packetDelimitSize));
            const sector = data.slice(i, i += sectorLength);
            result.push(processors[result.length](sector, dataCaps[result.length], packet, types[result.length] == PacketType.ENUMS ? enums++ : 0));
        }
        return result;
    };
}
export function createObjValidator(types: PacketType[], packetDelimitSize: number): (data: Uint8Array, dataCaps: number[], dataMins: number[], packet: Packet) => boolean {
    const validators = types.map(t => PacketValidityProcessors[t]);
    return (data: Uint8Array, dataCaps: number[], dataMins: number[], packet: Packet) => {
        let sectors = 0, enums = 0;
        for(let i=0;i<data.length;) {
            const sectorLength = deconvertBytePows(data.slice(i, i += packetDelimitSize));
            if(sectorLength + i > data.length) return false;
            const sector = data.slice(i, i += sectorLength);
            if(!validators[sectors](sector, dataCaps[sectors], dataMins[sectors], packet, types[sectors] == PacketType.ENUMS ? enums++ : 0)) return false;
            if(++sectors > dataCaps.length) return false; // caps length is also the amount of values there are
        }
        return true;
    };
}