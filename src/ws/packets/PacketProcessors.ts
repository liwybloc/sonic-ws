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

import { EnumPackage } from "../util/enums/EnumType";
import { splitArray } from "../util/ArrayUtil";
import { compressBools, convertFloat, convertBytePows, decompressBools, deconvertFloat, deconvertBytePows, demapShort_ZZ, demapZigZag, fromShort, fromSignedByte, fromSignedShort, mapShort_ZZ, mapZigZag, byteOverflowPow, sectorSize, SHORT_BITS, toByte, toShort, MAX_DSECT_SIZE, convertVarInt, MAX_BYTE, readVarInt, MAX_UVARINT } from "../util/packets/CompressionUtil";
import { Packet } from "./Packets";
import { PacketType } from "./PacketType";
import { as16String, as8String, splitBuffer } from "../util/BufferUtil";
import { processCharCodes, splitCodePoint } from "../util/StringUtil";

export type PacketTypeValidator = (data: Uint8Array, index: number) => false | any;
export type PacketReceiveProcessor = (data: Uint8Array, validationResult: any, index: number) => any;
export type PacketSendProcessor = (...data: any) => number[];

function BYTE_LEN(cap: number, min: number): PacketTypeValidator {
    return (data: Uint8Array) => data.length >= min && data.length <= cap;
}
function SHORT_LEN(cap: number, min: number): PacketTypeValidator {
    min *= 2;
    cap *= 2;
    return (data: Uint8Array) => data.length >= min && data.length <= cap && data.length % 2 == 0;
}

function VARINT_VERIF(cap: number, min: number, signed: boolean): PacketTypeValidator {
    return (data: Uint8Array) => {
        if(data.length == 0) return false;

        let sectors = 0, i = 0, computed = [];
        while(i < data.length) {
            const [off, varint] = readVarInt(data, i, signed);
            i = off;
            computed.push(varint);
            if(++sectors > cap) return false;
        }
        if(sectors < min) return false;

        return computed;
    }
};

export function createValidator(type: PacketType, dataCap: number, dataMin: number, enumData: EnumPackage[]): PacketTypeValidator {
    switch(type) {
        case PacketType.NONE        : return (data: Uint8Array) => data.length == 0;
        case PacketType.RAW         : return () => undefined;

        case PacketType.ENUMS       : return (data: Uint8Array, index: number) => {
            if (data.length < dataMin || data.length > dataCap || index >= enumData.length) return false;
            
            const pkg = enumData[index];
            for(let i=0;i<data.length;i++) {
                if(pkg.values.length <= data[i]) return false;
            }

            return undefined;
        }

        case PacketType.BYTES        : return BYTE_LEN(dataCap, dataMin);
        case PacketType.UBYTES       : return BYTE_LEN(dataCap, dataMin);
        case PacketType.BYTES_ZZ     : return BYTE_LEN(dataCap, dataMin);

        case PacketType.SHORTS       : return SHORT_LEN(dataCap, dataMin);
        case PacketType.USHORTS      : return SHORT_LEN(dataCap, dataMin);
        case PacketType.SHORTS_ZZ    : return SHORT_LEN(dataCap, dataMin);

        case PacketType.NUMBERS      : return (raw: Uint8Array) => {
            if(raw.length == 0) return false;

            const sectSize = raw[0];
            if(sectSize > MAX_DSECT_SIZE) return false;

            const dataLength = raw.length - 1;
            if(dataLength % sectSize != 0) return false;

            const valueAmount = dataLength / sectSize;
            if(valueAmount < dataMin || valueAmount > dataCap) return false;

            return undefined;
        };

        case PacketType.VARINT       : return VARINT_VERIF(dataCap, dataMin, true);
        case PacketType.UVARINT      : return VARINT_VERIF(dataCap, dataMin, false);
        case PacketType.VARINT_ZZ    : return VARINT_VERIF(dataCap, dataMin, false);
        case PacketType.DELTAS       : return VARINT_VERIF(dataCap, dataMin, false);

        case PacketType.FLOAT        : return (data: Uint8Array) => {
            if (data.length % 4 !== 0) return false;
            const sectors = data.length / 4;
            if (sectors > dataCap || sectors < dataMin) return false;
            return undefined;
        };

        case PacketType.BOOLEANS     : {
            const min = Math.floor(dataMin / 8);
            const cap = Math.floor(dataCap / 8);
            return (data: Uint8Array) => data.length >= min && data.length <= cap;
        };

        case PacketType.STRINGS_ASCII: return (data: Uint8Array) => {
            let sectors = 0, index = 0, computed = [];
            while(index < data.length) {
                sectors++;
                if(sectors > dataCap) return false;
                const [off, varint] = readVarInt(data, index, false);
                index = off + varint;
                computed.push(varint);
                if(index > data.length) return false;
            }
            if(sectors < dataMin) return false;
            return computed; // todo
        };
        case PacketType.STRINGS_UTF16: return (data: Uint8Array) => {
            let sectors = 0, index = 0, computed = [];
            while(index < data.length) {
                sectors++;
                if(sectors > dataCap) return false;
                const [off, varint] = readVarInt(data, index, false);
                index = off + varint * 2;
                computed.push(varint);
                if(index > data.length) return false;
            }
            if(sectors < dataMin) return false;
            return computed; // todo
        };

        default: throw new Error("Unknown type: " + type);
    }
}

export function createReceiveProcessor(type: PacketType, enumData: EnumPackage[], cap: number): PacketReceiveProcessor {
    switch(type) {
        case PacketType.NONE         : return () => undefined;
        case PacketType.RAW          : return (data: Uint8Array) => data;

        case PacketType.BYTES        : return (data) => Array.from(data).map(fromSignedByte);
        case PacketType.UBYTES       : return (data) => Array.from(data);
        case PacketType.BYTES_ZZ     : return (data) => Array.from(data).map(demapZigZag);

        case PacketType.SHORTS       : return (data) => splitBuffer(data, 2).map(v => fromSignedShort(v as SHORT_BITS));
        case PacketType.USHORTS      : return (data) => splitBuffer(data, 2).map(v => fromShort(v as SHORT_BITS));
        case PacketType.SHORTS_ZZ    : return (data) => splitBuffer(data, 2).map(v => demapShort_ZZ(v as SHORT_BITS));

        case PacketType.VARINT       : return (_, computed) => computed;
        case PacketType.UVARINT      : return (_, computed) => computed;
        case PacketType.VARINT_ZZ    : return (_, computed) => computed.map(demapZigZag);
        case PacketType.DELTAS       : return (_, computed) => computed.map((x: number, i: number) => computed[i] = (computed[i - 1] || 0) + demapZigZag(x));

        case PacketType.FLOAT        : return (data) => splitBuffer(data, 4).map(deconvertFloat);

        case PacketType.BOOLEANS     : return (data) => Array.from(data).map(d => decompressBools(d)).flat().splice(0, cap);

        case PacketType.NUMBERS      : return (data) => splitArray(data.subarray(1), data[0]).map(deconvertBytePows);

        case PacketType.ENUMS        : return (data: Uint8Array, _, index: number) => {
            const pkg: EnumPackage = enumData[index];
            return Array.from(data).map(code => pkg.values[code]);
        };

        case PacketType.STRINGS_ASCII: return (data: Uint8Array, computed: number[]) => {
            let off = 0;
            return computed.map(len => as8String(data.subarray(++off, off += len)));
        };
        case PacketType.STRINGS_UTF16: return (data: Uint8Array, computed: number[]) => {
            let off = 0;
            return computed.map(len => as16String(data.subarray(++off, off += len * 2)));
        }

        default: throw new Error("Unknown type: " + type);
    }
}

/** Creates a function that processes a packet type */
export function createSendProcessor(type: PacketType): PacketSendProcessor {
    switch(type) {
        case PacketType.NONE         : return () => [];
        case PacketType.RAW          : return (data: Uint8Array | number[]) => Array.from(data);

        case PacketType.ENUMS        : return (enums: number[]) => enums;

        case PacketType.BYTES        : return (numbers: number[]) => numbers.map(n => toByte(n, true));
        case PacketType.UBYTES       : return (numbers: number[]) => numbers.map(n => toByte(n, false));
        case PacketType.BYTES_ZZ     : return (numbers: number[]) => numbers.map(mapZigZag);

        case PacketType.SHORTS       : return (numbers: number[]) => numbers.map(n => toShort(n, true)).flat();
        case PacketType.USHORTS      : return (numbers: number[]) => numbers.map(n => toShort(n, false)).flat();
        case PacketType.SHORTS_ZZ    : return (numbers: number[]) => numbers.map(mapShort_ZZ).flat();

        case PacketType.VARINT       : return (numbers: number[]) => numbers.map(n => convertVarInt(n, true)).flat();
        case PacketType.UVARINT      : return (numbers: number[]) => numbers.map(n => convertVarInt(n, false)).flat();
        case PacketType.VARINT_ZZ    : return (numbers: number[]) => numbers.map(n => convertVarInt(mapZigZag(n), false)).flat();
        case PacketType.DELTAS       : return (numbers: number[]) => numbers.map((n, i) => convertVarInt(mapZigZag(n - (numbers[i - 1] || 0)), false)).flat();
        
        case PacketType.FLOAT        : return (floats: number[]) => floats.map(convertFloat).flat();
        case PacketType.BOOLEANS     : return (bools: boolean[]) => splitArray(bools, 8).map((bools: boolean[]) => compressBools(bools)).flat();

        case PacketType.NUMBERS      : return (numbers: number[]) => {
            const res: number[] = [];
            const sectSize = numbers.reduce((c, n) => Math.max(c, sectorSize(n, byteOverflowPow)), 1);
            res.push(sectSize);
            numbers.forEach(n => convertBytePows(n, sectSize).forEach(c => res.push(c)));
            return res;
        };

        case PacketType.STRINGS_ASCII: return (strings: any[]) => {
            const res: number[] = [];
            for(const v of strings) {
                const string = String(v);
                res.push(...convertVarInt(string.length, false));

                const codes = processCharCodes(string);

                const highCode = codes.find(x => x > MAX_BYTE)
                if(highCode) throw new Error(`Cannot store code ${highCode} (${String.fromCharCode(highCode)}) in a UTF-8 String! Use STRINGS_UTF16.`);

                codes.map(c => res.push(c));
            }
            return res;
        };
        case PacketType.STRINGS_UTF16: return (strings: any[]) => {
            const res: number[] = [];
            for(const v of strings) {
                const string = String(v);
                res.push(...convertVarInt(string.length, false));
                processCharCodes(string).map(c => res.push(...splitCodePoint(c).map(p => toShort(p, false)).flat()));
            }
            return res;
        };

        default: throw new Error("Unknown type: " + type);
    }
}

export function createObjSendProcessor(packet: Packet): PacketSendProcessor {
    const types = (packet.type as PacketType[]);

    const size = types.length;
    const processors = types.map(t => createSendProcessor(t));
    
    return (data: any[]) => {
        let result: number[] = [];
        for(let i=0;i<size;i++) {
            const sectorData = data[i];

            const d = processors[i](Array.isArray(sectorData) ? sectorData : [sectorData]);
            if(d.length > MAX_UVARINT) throw new Error(`Cannot send ${d.length}/${MAX_UVARINT} bytes of data!`);

            result.push(...convertVarInt(d.length, false));
            d.forEach(val => result.push(val));
        }
        return result;
    };
}
export function createObjReceiveProcessor(packet: Packet): PacketReceiveProcessor {
    const types = (packet.type as PacketType[]), dataMaxes = (packet.dataMax as number[]);
    const processors = types.map((t, i) => createReceiveProcessor(t, packet.enumData, dataMaxes[i]));

    return (data: Uint8Array, validationResult: any) => {
        let index = 0, enums = 0, result: any[] = [];

        while(index < data.length) {
            const [off, sectorLength] = readVarInt(data, index, false);
            index = off;

            const sector = data.subarray(index, index += sectorLength);
            result.push(processors[result.length](sector, validationResult[result.length], types[result.length] == PacketType.ENUMS ? enums++ : 0));
        }

        return result;
    };
}
export function createObjValidator(packet: Packet): PacketTypeValidator {
    const types = (packet.type as PacketType[]), dataMaxes = (packet.dataMax as number[]), dataMins = (packet.dataMin as number[]);
    const validators = types.map((t, i) => createValidator(t, dataMaxes[i], dataMins[i], packet.enumData));
    
    return (data: Uint8Array) => {
        let index = 0, enums = 0, computedData = [];

        while(index < data.length) {
            if(computedData.length > types.length) return false; // only types amount of values

            const [off, sectorLength] = readVarInt(data, index, false);
            index = off;

            if(sectorLength + index > data.length) return false;

            const sector = data.subarray(index, index += sectorLength);

            const result = validators[computedData.length](sector, types[computedData.length] == PacketType.ENUMS ? enums++ : 0);
            if(result == false) return false;

            computedData.push(result);
        }

        return computedData;
    };
}