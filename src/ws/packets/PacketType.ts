import { splitArray } from "../util/ArrayUtil";
import { convertINT_D, deconvertINT_D, fromSignedINT_C, NEGATIVE_C, processCodePoints, sectorSize, toSignedINT_C } from "../util/CodePointUtil";

export enum PacketType {
 
    /** No data to be received */
    NONE = 0,

    /** Raw string data */
    RAW = 1,
    /** Raw string data (alias) */
    STRING = 1,

    /** One or more numbers from -557,056 to 557,055 */
    INTS_C = 2,

    /** One or more numbers; compressed, but higher numbers will consume more bandwidth */
    INTS_D = 3,

    /** One decimal number; unoptimal */
    DECIMAL = 4,
    
}

const STRINGIFY = (data: any) => data.toString();

// todo: validity checks

export const PacketReceiveProcessors: Record<PacketType, (data: string) => "" | string | number | number[]> = {
    [PacketType.NONE]: (_) => "",
    [PacketType.RAW]: (data) => data,

    [PacketType.INTS_C]: (data) => processCodePoints(data).map(fromSignedINT_C),
    [PacketType.INTS_D]: (data) => splitArray(processCodePoints(data.substring(1)), data[0].codePointAt(0)!).map(arr => String.fromCodePoint(...arr)).map(deconvertINT_D),

    [PacketType.DECIMAL]: (data) => parseFloat(data),
};

export const PacketSendProcessors: Record<PacketType, (...data: any) => string> = {
    [PacketType.NONE]: (_) => "",
    [PacketType.RAW]: STRINGIFY,

    [PacketType.INTS_C]: (...numbers: number[]) => numbers.map(number => {
        if(number >= NEGATIVE_C) throw new Error("INT_C numbers cannot go above " + NEGATIVE_C);
        return String.fromCodePoint(toSignedINT_C(number));
    }).join(""),
    [PacketType.INTS_D]: (...numbers: number[]) => {
        const sectSize = numbers.reduce((c, n) => Math.max(c, sectorSize(n)), 1);
        const sects = numbers.map(n => convertINT_D(n, sectSize)).join("");
        return String.fromCodePoint(sectSize) + sects;
    },

    [PacketType.DECIMAL]: STRINGIFY,
}