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
import { compressBools, convertFloat, decompressBools, deconvertFloat, demapShort_ZZ, demapZigZag, fromShort, mapZigZag, SHORT_BITS, toByte, toShort, convertVarInt, MAX_BYTE, readVarInt, MAX_UVARINT, mapShort_ZZ, convertDouble, deconvertDouble, ONE_FOURTH, ONE_EIGHT, encodeHuffman, bytesToBits, decodeHuffman } from "../util/packets/CompressionUtil";
import { Packet } from "./Packets";
import { PacketType } from "./PacketType";
import { as8String, splitBuffer } from "../util/BufferUtil";
import { processCharCodes } from "../util/StringUtil";

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

function VARINT_VERIF(cap: number, min: number): PacketTypeValidator {
    return (data: Uint8Array) => {
        if(data.length == 0) return min <= 0 ? [] : false;

        let sectors = 0, i = 0, computed = [];
        while(i < data.length) {
            const [off, varint] = readVarInt(data, i);
            i = off;
            computed.push(varint);
            if(++sectors > cap) return false;
        }
        if(sectors < min) return false;

        return computed;
    }
};

export function createValidator<T extends PacketType>(type: T, dataCap: number, dataMin: number, packet: Packet<T | T[]>): PacketTypeValidator {
    switch(type) {
        case PacketType.NONE        : return (data: Uint8Array) => data.length == 0;
        case PacketType.RAW         : return () => undefined;

        case PacketType.ENUMS       : return (data: Uint8Array, index: number) => {
            if (data.length < dataMin || data.length > dataCap || index >= packet.enumData.length) return false;
            
            const pkg = packet.enumData[index];
            for(let i=0;i<data.length;i++) {
                if(pkg.values.length <= data[i]) return false;
            }
        }

        case PacketType.BYTES        : return BYTE_LEN(dataCap, dataMin);
        case PacketType.UBYTES       : return BYTE_LEN(dataCap, dataMin);

        case PacketType.SHORTS       : return SHORT_LEN(dataCap, dataMin);
        case PacketType.USHORTS      : return SHORT_LEN(dataCap, dataMin);

        case PacketType.VARINT       : return VARINT_VERIF(dataCap, dataMin);
        case PacketType.UVARINT      : return VARINT_VERIF(dataCap, dataMin);
        case PacketType.DELTAS       : return VARINT_VERIF(dataCap, dataMin);

        case PacketType.FLOATS       : return (data: Uint8Array) => {
            if (data.length % 4 !== 0) return false;
            const sectors = data.length * ONE_FOURTH;
            if (sectors > dataCap || sectors < dataMin) return false;
            return undefined;
        };
        case PacketType.DOUBLES       : return (data: Uint8Array) => {
            if (data.length % 8 !== 0) return false;
            const sectors = data.length * ONE_EIGHT;
            if (sectors > dataCap || sectors < dataMin) return false;
            return undefined;
        };

        case PacketType.BOOLEANS     : {
            const min = Math.ceil(dataMin * ONE_EIGHT);
            const cap = Math.ceil(dataCap * ONE_EIGHT);
            return (data: Uint8Array) => data.length >= min && data.length <= cap;
        };

        case PacketType.STRINGS_ASCII: return (data: Uint8Array) => {
            let index = 0;
            const [offCount, stringCount] = readVarInt(data, index);
            index = offCount;

            if (stringCount < dataMin || stringCount > dataCap) return false;

            const lengths: number[] = [];
            let totalLength = 0;
            for (let i = 0; i < stringCount; i++) {
                const [offLen, strLen] = readVarInt(data, index);
                index = offLen;
                lengths.push(strLen);
                totalLength += strLen;
            }

            if (index + Math.ceil(totalLength / 8) > data.length) return false;

            return [ stringCount, lengths, index ];
        };
        case PacketType.STRINGS_UTF16: return (data: Uint8Array) => {
            let sectors = 0, index = 0, computed: number[][] = [];

            while (index < data.length) {
                sectors++;
                if (sectors > dataCap) return false;

                const [off, strLength] = readVarInt(data, index);
                index = off;

                let string: number[] = [];
                for (let i = 0; i < strLength; i++) {
                    const [newOff, char] = readVarInt(data, index);
                    index = newOff;
                    if (index > data.length) return false;
                    string.push(char);
                }

                computed.push(string);
            }

            if (sectors < dataMin) return false;

            return computed;
        };


        default: throw new Error("Unknown type: " + type);
    }
}

export function createReceiveProcessor(type: PacketType, enumData: EnumPackage[], cap: number): PacketReceiveProcessor {
    switch(type) {
        case PacketType.NONE         : return () => undefined;
        case PacketType.RAW          : return (data: Uint8Array) => data;

        case PacketType.BYTES        : return (data) => Array.from(data).map(demapZigZag);
        case PacketType.UBYTES       : return (data) => Array.from(data);

        case PacketType.SHORTS       : return (data) => splitBuffer(data, 2).map(v => demapShort_ZZ(v as SHORT_BITS));
        case PacketType.USHORTS      : return (data) => splitBuffer(data, 2).map(v => fromShort(v as SHORT_BITS));

        case PacketType.VARINT       : return (_, computed) => computed.map(demapZigZag);
        case PacketType.UVARINT      : return (_, computed) => computed;
        case PacketType.DELTAS       : return (_, computed) => computed.map((x: number, i: number) => computed[i] = (computed[i - 1] || 0) + demapZigZag(x));

        case PacketType.FLOATS       : return (data) => splitBuffer(data, 4).map(deconvertFloat);
        case PacketType.DOUBLES      : return (data) => splitBuffer(data, 8).map(deconvertDouble);

        case PacketType.BOOLEANS     : return (data) => Array.from(data).map(d => decompressBools(d)).flat().splice(0, cap);

        case PacketType.ENUMS        : return (data: Uint8Array, _, index: number) => {
            const pkg: EnumPackage = enumData[index];
            return Array.from(data).map(code => pkg.values[code]);
        };

        case PacketType.STRINGS_ASCII: return (data: Uint8Array, validationResult: [number, number[], number]) => {
            const [ stringCount, lengths, dataStart ] = validationResult;
            const bitString = bytesToBits(data.subarray(dataStart));

            const decoded = decodeHuffman(bitString);
            if (!decoded) return [];

            const strings: string[] = [];
            let offset = 0;
            for (let i = 0; i < stringCount; i++) {
                strings.push(decoded.slice(offset, offset + lengths[i]));
                offset += lengths[i];
            }

            return strings;
        };

        case PacketType.STRINGS_UTF16: return (data: Uint8Array, computed: number[][]) => {
            return computed.map(codes => String.fromCodePoint(...codes));
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

        case PacketType.BYTES        : return (numbers: number[]) => numbers.map(mapZigZag);
        case PacketType.UBYTES       : return (numbers: number[]) => numbers.map(toByte);

        case PacketType.SHORTS       : return (numbers: number[]) => numbers.map(mapShort_ZZ).flat();
        case PacketType.USHORTS      : return (numbers: number[]) => numbers.map(toShort).flat();

        case PacketType.VARINT       : return (numbers: number[]) => numbers.map(n => convertVarInt(mapZigZag(n))).flat();
        case PacketType.UVARINT      : return (numbers: number[]) => numbers.map(convertVarInt).flat();
        case PacketType.DELTAS       : return (numbers: number[]) => numbers.map((n, i) => convertVarInt(mapZigZag(n - (numbers[i - 1] || 0)))).flat();
        
        case PacketType.FLOATS       : return (singles: number[]) => singles.map(convertFloat).flat();
        case PacketType.DOUBLES      : return (doubles: number[]) => doubles.map(convertDouble).flat(); 

        case PacketType.BOOLEANS     : return (bools: boolean[]) => splitArray(bools, 8).map((bools: boolean[]) => compressBools(bools)).flat();

        case PacketType.STRINGS_ASCII: return (strings: any[]) => {
            return [
                ...convertVarInt(strings.length),
                ...strings.map(str => convertVarInt(str.length)).flat(),
                ...encodeHuffman(strings.reduce((a, b) => a + String(b), "")),
            ];
        };
        case PacketType.STRINGS_UTF16: return (strings: any[]) => {
            const res: number[] = [];
            for(const v of strings) {
                const string = String(v);
                const charCodes = processCharCodes(string);
                // hate js man
                const length = charCodes.length;
                res.push(...convertVarInt(length));
                res.push(...charCodes.map(convertVarInt).flat());
            }
            return res;
        };

        default: throw new Error("Unknown type: " + type);
    }
}

export function createObjSendProcessor(packet: Packet<PacketType[]>): PacketSendProcessor {
    const size = packet.type.length;
    const processors = packet.type.map(t => createSendProcessor(t));
    
    return (data: any[]) => {
        let result: number[] = [];
        for(let i=0;i<size;i++) {
            const sectorData = data[i];

            const d = processors[i](Array.isArray(sectorData) ? sectorData : [sectorData]);
            if(d.length > MAX_UVARINT) throw new Error(`Cannot send ${d.length}/${MAX_UVARINT} bytes of data!`);

            result.push(...convertVarInt(d.length));
            d.forEach(val => result.push(val));
        }
        return result;
    };
}
export function createObjReceiveProcessor(packet: Packet<PacketType[]>): PacketReceiveProcessor {
    const processors = packet.type.map((t, i) => createReceiveProcessor(t, packet.enumData, packet.dataMax[i]));

    return (data: Uint8Array, validationResult: any) => {
        let index = 0, enums = 0, result: any[] = [];

        while(index < data.length) {
            // TODO: this does not need sector length because objects are actually deterministically sized in each one!!
            const [off, sectorLength] = readVarInt(data, index);
            index = off;

            const sector = data.subarray(index, index += sectorLength);
            // basically make this return the ending index
            // *only works if dataMax=dataMin
            result.push(processors[result.length](sector, validationResult[result.length], packet.type[result.length] == PacketType.ENUMS ? enums++ : 0));
        }

        return result;
    };
}
export function createObjValidator(packet: Packet<PacketType[]>): PacketTypeValidator {
    const validators = packet.type.map((t, i) => createValidator(t, packet.dataMax[i], packet.dataMin[i], packet));
    
    return (data: Uint8Array) => {
        let index = 0, enums = 0, computedData = [];

        while(index < data.length) {
            if(computedData.length > packet.type.length) return false; // only types amount of values

            const [off, sectorLength] = readVarInt(data, index);
            index = off;

            if(sectorLength + index > data.length) return false;

            const sector = data.subarray(index, index += sectorLength);

            const result = validators[computedData.length](sector, packet.type[computedData.length] == PacketType.ENUMS ? enums++ : 0);
            if(result === false) return false; // chat i used === to fix a bug !!!!

            computedData.push(result);
        }

        return computedData;
    };
}

type BuildTuple<T, N extends number, R extends unknown[] = []> = 
    R['length'] extends N ? R : BuildTuple<T, N, [T, ...R]>;

export type PacketResponse<
    T extends PacketType | readonly PacketType[],
    N extends number | readonly number[]
> =
    T extends PacketType[]
        ? N extends number[]
            ? PacketResponseArray<T, N>
            : never
        : BuildTuple<
            T extends PacketType.NONE ? undefined :
            T extends PacketType.RAW ? Uint8Array :
            T extends PacketType.BYTES | PacketType.UBYTES ? number :
            T extends PacketType.SHORTS | PacketType.USHORTS ? number :
            T extends PacketType.VARINT | PacketType.UVARINT | PacketType.DELTAS ? number :
            T extends PacketType.FLOATS | PacketType.DOUBLES ? number :
            T extends PacketType.BOOLEANS ? boolean :
            T extends PacketType.STRINGS_ASCII | PacketType.STRINGS_UTF16 ? string :
            T extends PacketType.ENUMS ? any
            : never,
            N extends number ? N : never
        >;

type PacketResponseArray<
    T extends PacketType[],
    N extends number[]
> = { [K in keyof T]: K extends number ? PacketResponse<T[K], N[K] & number> : never };
