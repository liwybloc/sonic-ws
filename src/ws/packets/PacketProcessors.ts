import { EnumPackage } from "../enums/EnumType";
import { splitArray } from "../util/ArrayUtil";
import { compressBools, convertINT_D, decompressBools, deconvertINT_D, deconvertINT_DCodes, fromSignedINT_C, NULL, processCharCodes, sectorSize, stringedINT_C } from "../util/CodePointUtil";
import { Packet } from "./Packets";
import { PacketType } from "./PacketType";

const STRINGIFY = (data: any) => data.toString();

const LEN_DELIMIT = (data: string, cap: number) => {
    let sectors = 0;
    for(let index = 0; index < data.length; index++) {
        sectors++;
        if(sectors > cap) return false;
        index += data.charCodeAt(index);
        if(index + 1 > data.length) return false;
    }
    return true;
}

export const PacketValidityProcessors: Record<PacketType, (data: string, dataCap: number, packet: Packet, index: number) => boolean> = {
    [PacketType.NONE]: (data) => data.length == 0,
    [PacketType.RAW]: () => true,

    [PacketType.STRINGS]: LEN_DELIMIT,
    [PacketType.ENUMS]: (data, cap, packet, index) => {
        if (data.length > cap || index >= packet.enumData.length) return false;
        const pkg = packet.enumData[index];
        for(let i=0;i<cap;i++) {
            if(pkg.values.length <= data.charCodeAt(i)) return false;
        }
        return true;
    },

    [PacketType.INTS_C]: (data, cap) => data.length == cap,
    [PacketType.INTS_D]: (data, cap) => data.length > 0 && (processCharCodes(data).length - 1) % data[0].charCodeAt(0)! <= cap,
    [PacketType.INTS_A]: LEN_DELIMIT,
     
    [PacketType.DECIMALS]: (data, cap) => {
        let sectors = 0;
        for(let i = 0; i < data.length;) {
            sectors++;
            if(sectors > cap) return false;
            const sectorBits = data.charCodeAt(i++);
            const len = sectorBits >> 7;
            const len2 = sectorBits & 0x7F;
            i += len;
            if(i > data.length) return false;
            i += len2;
            if(i > data.length) return false;
        }
        return true;
    },

    [PacketType.BOOLEANS]: (data, cap) => {
        const codes = processCharCodes(data);
        return codes.length <= Math.floor(cap / 8) + 1 && codes.find(d => d > 255) == undefined;
    }
}

export const PacketReceiveProcessors: Record<PacketType, (data: string, cap: number, packet: Packet, index: number) => "" | string | string[] | number | number[] | boolean[]> = {
    [PacketType.NONE]: (_) => "",
    [PacketType.RAW]: (data) => data,

    [PacketType.STRINGS]: (data) => {
        let strings: string[] = [];
        for(let i = 0; i < data.length; i++) {
            const stringSize = data.charCodeAt(i);
            strings.push(data.substring(i + 1, i + 1 + stringSize));
            i += stringSize;
        }
        return strings;
    },
    [PacketType.ENUMS]: (data, _, packet, index) => {
        const pkg: EnumPackage = packet.enumData[index];
        return processCharCodes(data).map(code => pkg.values[code]);
    },

    [PacketType.INTS_C]: (data) => processCharCodes(data).map(fromSignedINT_C),
    [PacketType.INTS_D]: (data) => splitArray(processCharCodes(data.substring(1)), data.charCodeAt(0)!).map(arr => String.fromCharCode(...arr)).map(deconvertINT_D),
    [PacketType.INTS_A]: (data) => {
        let numbers: number[] = [];
        for(let i = 0; i < data.length; i++) {
            const sectSize = data.charCodeAt(i);
            numbers.push(deconvertINT_D(data.substring(i + 1, i + 1 + sectSize)));
            i += sectSize;
        }
        return numbers;
    },

    [PacketType.DECIMALS]: (data) => {
        const points = processCharCodes(data);
        let numbers: number[] = [];
        for(let i = 0; i < points.length;) {
            const sectorBits = points[i++];

            const wholeSS = sectorBits >> 7;
            const decimalSS = sectorBits & 0x7F;

            const whole = deconvertINT_DCodes(points.slice(i, i + wholeSS));
            i += wholeSS;

            const decimal = deconvertINT_DCodes(points.slice(i, i + decimalSS));
            i += decimalSS;

            numbers.push(parseFloat(whole + "." + decimal));
        }

        return numbers;
    },

    [PacketType.BOOLEANS]: (data, cap) => processCharCodes(data).map(d => decompressBools(d)).flat().splice(0, cap),
};

export const PacketSendProcessors: Record<PacketType, (...data: any) => string> = {
    [PacketType.NONE]: (_) => "",
    [PacketType.RAW]: STRINGIFY,

    // todo: try some kind of string compression ig :p
    [PacketType.STRINGS]: (...strings: any[]) => strings.map(string => String.fromCharCode(string.toString().length) + string).join(""),
    [PacketType.ENUMS]: (...enums: string[]) => enums.join(""),

    [PacketType.INTS_C]: (...numbers: number[]) => numbers.map(stringedINT_C).join(""),
    [PacketType.INTS_D]: (...numbers: number[]) => {
        const sectSize = numbers.reduce((c, n) => Math.max(c, sectorSize(n)), 1);
        const sects = numbers.map(n => convertINT_D(n, sectSize).padStart(sectSize, NULL)).join("");
        return String.fromCharCode(sectSize) + sects;
    },
    [PacketType.INTS_A]: (...numbers: number[]) => numbers.map(v => {
        const sectSize = sectorSize(v);
        return String.fromCharCode(sectSize) + convertINT_D(v, sectSize);
    }).join(""),

    [PacketType.DECIMALS]: (...numbers: number[]) => numbers.map(n => {
        const split = n.toString().split(".");

        const whole = parseFloat(split[0]) || 0;
        const decimal = split.length > 1 ? parseFloat(split[1]) || 0 : 0;

        const wholeSS = sectorSize(whole);
        const decimalSS = sectorSize(decimal);

        const num = (wholeSS << 7) | decimalSS;

        return String.fromCharCode(num) + convertINT_D(whole, wholeSS) + convertINT_D(decimal, decimalSS);
    }).join(""),
    
    [PacketType.BOOLEANS]: (...bools: boolean[]) => splitArray(bools, 7).map(bools => String.fromCharCode(compressBools(bools))).join(""),
}

export function createObjSendProcessor(types: PacketType[]): (...data: any[]) => string {
    const size = types.length;
    const processors = types.map(t => PacketSendProcessors[t]);
    return (...data: any[]) => {
        let result = "";
        for(let i=0;i<size;i++) {
            const d = processors[i](...data[i]);
            result += String.fromCharCode(d.length) + d;
        }
        return result;
    };
}
export function createObjReceiveProcesor(types: PacketType[]): (data: string, dataCaps: number[], packet: Packet) => any {
    const processors = types.map(t => PacketReceiveProcessors[t]);
    return (data: string, dataCaps: number[], packet: Packet) => {
        let result: any[] = [];
        let enums = 0;
        for(let i=0;i<data.length;) {
            const sectionLength = data.charCodeAt(i++);
            const sector = data.substring(i, i + sectionLength);
            result.push(processors[result.length](sector, dataCaps[result.length], packet, types[result.length] == PacketType.ENUMS ? enums++ : 0));
            i += sectionLength;
        }
        return result;
    };
}
// todo
export function createObjValidator(types: PacketType[]): (data: string, dataCaps: number[], packet: Packet) => boolean {
    const validators = types.map(t => PacketValidityProcessors[t]);
    return (data: string, dataCaps: number[], packet: Packet) => {
        let sectors = 0, enums = 0;
        for(let i=0;i<data.length;) {
            const sectorLength = data.charCodeAt(i++);
            if(sectorLength + i > data.length) return false;
            const sector = data.slice(i, i += sectorLength);
            if(!validators[sectors](sector, dataCaps[sectors], packet, types[sectors] == PacketType.ENUMS ? enums++ : 0)) return false;
            if(++sectors > dataCaps.length) return false; // caps length is also the amount of values there are
        }
        return true;
    };
}