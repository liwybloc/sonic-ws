import { fromSignedINT_C, NEGATIVE_C, processCodePoints, toSignedINT_C } from "../utl/CodePointUtil";

export enum PacketType {
 
    /** No data to be received */
    NONE = 0,

    /** Raw string data */
    RAW = 1,
    /** Raw string data (alias) */
    STRING = 1,

    /** A single integer is received */
    INT = 2,
    /** A single decimal is received */
    DECIMAL = 3,

    /** One or more numbers from -557,056 to 557,055 */
    INTS_C = 4,

    /** One or more numbers; compressed, but higher numbers will consume more bandwidth */
    INTS_D = 5,
    
}

const STRINGIFY = (data: any) => data.toString();

// todo: validity checks

export const PacketReceiveProcessors: Record<PacketType, (data: string) => "" | string | number | number[]> = {
    [PacketType.NONE]: (_) => "",
    [PacketType.RAW]: (data) => data,

    [PacketType.INT]: (data) => parseInt(data),
    [PacketType.DECIMAL]: (data) => parseFloat(data),

    [PacketType.INTS_C]: (data) => processCodePoints(data).map(fromSignedINT_C),
    
    [PacketType.INTS_D]: (data) => "",
};

export const PacketSendProcessors: Record<PacketType, (...data: any) => string> = {
    [PacketType.NONE]: (_) => "",
    [PacketType.RAW]: STRINGIFY,

    [PacketType.INT]: STRINGIFY,
    [PacketType.DECIMAL]: STRINGIFY,

    [PacketType.INTS_C]: (...numbers: number[]) => numbers.map(number => {
        if(number >= NEGATIVE_C) throw new Error("INT_C numbers cannot go above " + NEGATIVE_C);
        return String.fromCodePoint(toSignedINT_C(number));
    }).join(""),

    [PacketType.INTS_D]: (data) => "",
}