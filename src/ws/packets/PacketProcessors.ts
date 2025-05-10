import { splitArray } from "../util/ArrayUtil";
import { compressBools, convertINT_D, decompressBools, deconvertINT_D, deconvertINT_DCodes, fromSignedINT_C, processCharCodes, sectorSize, stringedINT_C } from "../util/CodePointUtil";
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

export const PacketValidityProcessors: Record<PacketType, (data: string, dataCap: number) => boolean> = {
    [PacketType.NONE]: (data) => data == "",
    [PacketType.RAW]: () => true,

    [PacketType.STRINGS]: LEN_DELIMIT,

    [PacketType.INTS_C]: (data, cap) => data.length == cap,
    [PacketType.INTS_D]: (data, cap) => data.length > 0 && (processCharCodes(data).length - 1) % data[0].charCodeAt(0)! <= cap,
    [PacketType.INTS_A]: LEN_DELIMIT,
     
    [PacketType.DECIMALS]: (data, cap) => {
        let sectors = 0;
        for(let i = 0; i < data.length; i++) {
            sectors++;
            if(sectors > cap) return false;
            const len = data.charCodeAt(i);
            i += len + 1;
            if(i > data.length) return false;
            const len2 = data.charCodeAt(i);
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

export const PacketReceiveProcessors: Record<PacketType, (data: string, cap: number) => "" | string | string[] | number | number[] | boolean[]> = {
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

    [PacketType.INTS_C]: (data) => processCharCodes(data).map(fromSignedINT_C),
    [PacketType.INTS_D]: (data) => splitArray(processCharCodes(data.substring(1)), data[0].charCodeAt(0)!).map(arr => String.fromCharCode(...arr)).map(deconvertINT_D),
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
            const wholeSS = points[i++];
            const whole = deconvertINT_DCodes(points.slice(i, i + wholeSS));
            i += wholeSS;

            const decimalSS = points[i++];
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

    [PacketType.INTS_C]: (...numbers: number[]) => numbers.map(stringedINT_C).join(""),
    [PacketType.INTS_D]: (...numbers: number[]) => {
        const sectSize = numbers.reduce((c, n) => Math.max(c, sectorSize(n)), 1);
        const sects = numbers.map(n => convertINT_D(n, sectSize)).join("");
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

        return String.fromCharCode(wholeSS) + convertINT_D(whole, wholeSS) + String.fromCharCode(decimalSS) + convertINT_D(decimal, decimalSS);
    }).join(""),
    
    [PacketType.BOOLEANS]: (...bools: boolean[]) => splitArray(bools, 8).map(bools => String.fromCharCode(compressBools(bools))).join(""),
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
export function createObjReceiveProcesor(types: PacketType[], dataCaps: number[]): (data: string, caps: number[]) => any {
    const processors = types.map(t => PacketReceiveProcessors[t]);
    return (data: string) => {
        let result: any[] = [];
        for(let i=0;i<data.length;) {
            const sectionLength = data.charCodeAt(i++);
            const sector = data.substring(i, i + sectionLength);
            result.push(processors[result.length](sector, dataCaps[result.length]));
            i += sectionLength;
        }
        return result;
    };
}
export function createObjValidator(types: PacketType[], dataCaps: number[]): (data: string, caps: number[]) => boolean {
    return () => true;
}