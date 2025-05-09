import { splitArray } from "../util/ArrayUtil";
import { convertINT_D, deconvertINT_D, fromSignedINT_C, NULL, processCharCodes, sectorSize, stringedINT_C } from "../util/CodePointUtil";

export enum PacketType {
 
    /** No data */
    NONE = 0,

    /** Raw string data */
    RAW = 1,
    /** Raw string data (alias) */
    STRING = 1,

    /** One or more numbers from -27,648 to 27,647 */
    INTS_C = 2,

    /** One or more numbers of any size. Similar maximum size will produce maximum efficiency */
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

    [PacketType.INTS_C]: (data, cap) => data.length == cap,// same here \/\/\/\/
    [PacketType.INTS_D]: (data, cap) => data.length > 0 && (processCharCodes(data).length - 1) % data[0].charCodeAt(0)! <= cap,
     
    [PacketType.DECIMAL]: (data, cap) => data.length > 0 && (processCharCodes(data).length - 1) % data[0].charCodeAt(0)! * 2 <= cap,

    [PacketType.BOOLEAN]: (data) => data == NULL || data == "",
}

// todo: code points might make it need to substring(2) but idk if i need to care abt that-
export const PacketReceiveProcessors: Record<PacketType, (data: string) => "" | string | number | number[] | boolean> = {
    [PacketType.NONE]: (_) => "",
    [PacketType.RAW]: (data) => data,

    [PacketType.INTS_C]: (data) => processCharCodes(data).map(fromSignedINT_C),
    [PacketType.INTS_D]: (data) => splitArray(processCharCodes(data.substring(1)), data[0].charCodeAt(0)!).map(arr => String.fromCharCode(...arr)).map(deconvertINT_D),

    [PacketType.DECIMAL]: (data) => {
        const points = processCharCodes(data);
        const sectSize = points.shift()!;
        const sects = splitArray(points, sectSize).map(arr => String.fromCharCode(...arr)).map(deconvertINT_D);
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
        return String.fromCharCode(sectSize) + sects;
    },

    [PacketType.DECIMAL]: (data) => {
        const split = data.toString().split(".");
        const whole = parseFloat(split[0]) || 0;
        const decimal = split.length > 1 ? parseFloat(split[1]) || 0 : 0;

        const sectSize = Math.max(sectorSize(whole), sectorSize(decimal));
        return String.fromCharCode(sectSize) + convertINT_D(whole, sectSize) + convertINT_D(decimal, sectSize);
    },
    
    [PacketType.BOOLEAN]: (data) => data ? NULL : "",
}

export class Packet {
    public tag: string;
    public type: PacketType;
    public dataCap: number;
    public dontSpread: boolean;

    constructor(tag: string, type: PacketType, dataCap: number, dontSpread: boolean) {
        this.tag = tag;
        this.type = type;
        this.dataCap = dataCap;
        this.dontSpread = dontSpread;
    }

    public serialize(): string {
        return `${this.dontSpread ? 1 : 0}${String.fromCharCode(this.dataCap + 1)}${String.fromCharCode(this.type + 1)}${String.fromCharCode(this.tag.length + 1)}${this.tag}`;
    }

    public static deserialize(text: string, offset: number): [packet: Packet, tagLength: number] {
        const dontSpread: boolean = text[offset] == "1";
        const dataCap: number = text.charCodeAt(offset + 1) - 1;
        const type: PacketType = (text.charCodeAt(offset + 2) - 1) as PacketType;
        
        const tagLength: number = text.charCodeAt(offset + 3) - 1;
        const tag: string = text.substring(offset + 4, offset + 4 + tagLength);

        return [new Packet(tag, type, dataCap, dontSpread), tagLength];
    }
    
    public static deserializeAll(text: string): Packet[] {
        const arr: Packet[] = [];
        let offset = 0;
        while(offset < text.length) {
            const [packet, len] = this.deserialize(text, offset);
            arr.push(packet);
            offset += 4 + len;
        }

        return arr;
    }
}