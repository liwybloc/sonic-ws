import { splitArray } from "../util/ArrayUtil";
import { convertINT_D, deconvertINT_D, fromSignedINT_C, NEGATIVE_C, NULL, processCodePoints, sectorSize, stringedINT_C, toSignedINT_C } from "../util/CodePointUtil";

export enum PacketType {
 
    /** No data */
    NONE = 0,

    /** Raw string data */
    RAW = 1,
    /** Raw string data (alias) */
    STRING = 1,

    /** One or more numbers from -557,056 to 557,055 */
    INTS_C = 2,

    /** One or more numbers. Similar maximum size will produce maximum efficiency */
    INTS_D = 3,

    /** One decimal number; unoptimal */
    DECIMAL = 4,

    /** true/false */
    BOOLEAN = 6,
    
}

const STRINGIFY = (data: any) => data.toString();

// todo: validity checks

export const PacketValidityProcessors: Record<PacketType, (data: string, dataCap: number) => boolean> = {
    [PacketType.NONE]: (data) => data == "",
    [PacketType.RAW]: () => true,

    [PacketType.INTS_C]: () => true,                     // same here \/\/\/\/
    [PacketType.INTS_D]: (data, cap) => data.length > 0 && (data.length - 1) == data[0].codePointAt(0)! * cap,
    
    [PacketType.DECIMAL]: () => true,

    [PacketType.BOOLEAN]: (data) => data == NULL || data == "",
}

// todo: code points might make it need to substring(2) but idk if i need to care abt that-
export const PacketReceiveProcessors: Record<PacketType, (data: string) => "" | string | number | number[] | boolean> = {
    [PacketType.NONE]: (_) => "",
    [PacketType.RAW]: (data) => data,

    [PacketType.INTS_C]: (data) => processCodePoints(data).map(fromSignedINT_C),
    [PacketType.INTS_D]: (data) => splitArray(processCodePoints(data.substring(1)), data[0].codePointAt(0)!).map(arr => String.fromCodePoint(...arr)).map(deconvertINT_D),

    [PacketType.DECIMAL]: (data) => {
        const points = processCodePoints(data);
        const sectSize = points.shift()!;
        const sects = splitArray(points, sectSize).map(arr => String.fromCodePoint(...arr)).map(deconvertINT_D);
        return parseFloat(sects[0] + "." + sects[1]);
    },

    [PacketType.BOOLEAN]: (data) => data == NULL,
};

export const PacketSendProcessors: Record<PacketType, (...data: any) => string> = {
    [PacketType.NONE]: (_) => "",
    [PacketType.RAW]: STRINGIFY,

    [PacketType.INTS_C]: (...numbers: number[]) => numbers.map(stringedINT_C).join(""),
    [PacketType.INTS_D]: (...numbers: number[]) => {
        const sectSize = numbers.reduce((c, n) => Math.max(c, sectorSize(n)), 1);
        const sects = numbers.map(n => convertINT_D(n, sectSize)).join("");
        return String.fromCodePoint(sectSize) + sects;
    },

    [PacketType.DECIMAL]: (data) => {
        const split = data.toString().split(".");
        const whole = parseFloat(split[0]) || 0;
        const decimal = split.length > 1 ? parseFloat(split[1]) || 0 : 0;

        const sectSize = Math.max(sectorSize(whole), sectorSize(decimal));
        return String.fromCodePoint(sectSize) + convertINT_D(whole, sectSize) + convertINT_D(decimal, sectSize);
    },
    
    [PacketType.BOOLEAN]: (data) => data ? NULL : "",
}