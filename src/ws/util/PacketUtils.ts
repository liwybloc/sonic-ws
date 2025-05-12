import { PacketHolder } from "./PacketHolder";
import { Packet, PacketSchema } from "../packets/Packets";
import { PacketType } from "../packets/PacketType";
import { NULL, MAX_C } from "./CodePointUtil";
import { DefineEnum } from "../enums/EnumHandler";
import { EnumPackage, EnumValue } from "../enums/EnumType";

export function emitPacket(packets: PacketHolder, send: (data: string) => void, tag: string, values: any[]) {
    const code = packets.getChar(tag);
    if(code == NULL) throw new Error(`Tag "${tag}" has not been created!`);

    const packet = packets.getPacket(tag);
    if(values.length > packet.size) throw new Error(`Packet "${tag}" only allows ${packet.size} values!`);

    if(!packet.object) {
        const found = values.find(v => typeof v == 'object' && v != null && !(v instanceof EnumValue));
        if(found) console.warn(`Passing an array will result in undefined behavior (${JSON.stringify(found)}). Spread the array with ...arr`);
    }

    send(code + packet.processSend(values));
}

function isValidType(type: any): boolean {
    return (typeof type == 'number' && type in PacketType) || type instanceof EnumPackage;
}

function clampDataCap(dataCap: number) {
    if(dataCap > MAX_C) {
        console.warn(`Only ${MAX_C} values can be sent in a single type! Use CreateObjPacket() if you want to send more.`);
        return MAX_C;
    }
    return dataCap;
}

/**
 * Creates a structure for a simple single-typed packet
 * @param tag The tag of the packet; for on(tag) and send(tag, ...)
 * @param type The packet type; defaults to none
 * @param dataCap The data cap (amount of values that can be sent); defaults to 1
 * @param dontSpread If true, the values will be kept in an array instead of spread
 * @returns The packet structure data
 */
export function CreatePacket(tag: string, type: (PacketType | EnumPackage) = PacketType.NONE, dataCap: number = 1, dontSpread: boolean = false): Packet {
    if(!isValidType(type)) throw new Error("Invalid packet type: " + type);
    return new Packet(tag, PacketSchema.single(type, clampDataCap(dataCap), dontSpread));
}

/**
 * Creates a structure for an object (multi-typed) packet
 * @param tag The tag of the packet; for on(tag) and send(tag, ...)
 * @param types The types in the packet, in order
 * @param dataCaps The data cap (amount of values that can be sent) for each type, in order
 * @param dontSpread If true, the values will be kept in an array instead of spread
 * @returns The packet structure data
 */
export function CreateObjPacket(tag: string, types: (PacketType | EnumPackage)[], dataCaps: number[], dontSpread: boolean = false): Packet {
    const invalid = types.find(type => !isValidType(type));
    if(invalid) throw new Error("Invalid packet type: " + invalid);
    dataCaps = dataCaps.map(clampDataCap);
    return new Packet(tag, PacketSchema.object(types, dataCaps, dontSpread));
}

/**
 * Creates and defines an enum packet. In an object, you can do DefineEnum() for the type
 * @param packetTag The tag of the packet; for on(tag) and send(tag, ...)
 * @param enumTag The tag of the enum; for send(tag, WrapEnum(enumTag, value))
 * @param strings The possible values of the enum
 * @param dataCap The data cap (amount of values that can be sent); defaults to 1
 * @returns The packet structure data
 */
export function CreateEnumPacket(packetTag: string, enumTag: string, strings: string[], dataCap: number = 1, dontSpread: boolean = false): Packet {
    return CreatePacket(packetTag, DefineEnum(enumTag, strings), dataCap, dontSpread);
}