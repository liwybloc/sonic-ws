import { PacketHolder } from "./PacketHolder";
import { Packet, PacketSchema } from "../packets/Packets";
import { PacketType } from "../packets/PacketType";
import { NULL, MAX_C } from "./CodePointUtil";
import { DefineEnum } from "../enums/EnumHandler";
import { EnumPackage } from "../enums/EnumType";

export function emitPacket(packets: PacketHolder, send: (data: string) => void, tag: string, values: any[]) {
    const code = packets.getChar(tag);
    if(code == NULL) throw new Error(`Tag "${tag}" has not been created!`);

    const packet = packets.getPacket(tag);
    if(values.length > packet.maxSize) throw new Error(`Packet "${tag}" only allows ${packet.maxSize} values!`);
    if(values.length < packet.minSize) throw new Error(`Packet "${tag}" requires at least ${packet.minSize} values!`);

    if(!packet.object) {
        const found = values.find(v => typeof v == 'object' && v != null);
        if(found) console.warn(`Passing an array will result in undefined behavior (${JSON.stringify(found)}). Spread the array with ...arr`);
    }

    send(code + (values.length > 0 ? packet.processSend(values) : ""));
}

function isValidType(type: any): boolean {
    return (typeof type == 'number' && type in PacketType) || type instanceof EnumPackage;
}

function clampDataMax(dataMax: number) {
    if(dataMax > MAX_C) {
        console.warn(`Only ${MAX_C} values can be sent in a single type! Use CreateObjPacket() if you want to send more.`);
        return MAX_C;
    }
    return dataMax;
}
function clampDataMin(dataMin: number, dataMax: number) {
    if(dataMin < 0) {
        console.warn(`Having a data minimum below 0 does not do anything!`);
        return 0;
    }
    // also catches >MAX_C
    if(dataMin > dataMax) {
        console.warn(`Data minimum can not be higher than the data maximum!`);
        return dataMax;
    }
    return dataMin;
}

export type ArguableType = PacketType | EnumPackage;

/** Settings for single-typed packets */
export type SinglePacketSettings = {
    /** The tag of the packet; used for on(tag) and send(tag) */
    tag: string;
    /** The data type of the packet; defaults to PacketType.NONE */
    type?: ArguableType;
    /** The maximum amount of values that can be sent through this packet; defaults to 1 */
    dataMax?: number;
    /** The minimum amount of values that can be sent through this packet; defaults to the max */
    dataMin?: number;
    /** If the values should be kept in an array or spread along the listener; defaults to false */
    dontSpread?: boolean;
    /** A validation function that is called whenever data is received. Return true for success, return false to kick socket. */
    validator?: ((values: any[]) => boolean) | null;
};

/** Settings for multi-typed packets */
export type MultiPacketSettings = {
    /** The tag of the packet; used for on(tag) and send(tag) */
    tag: string;
    /** The data types of the packet */
    types: ArguableType[];
    /** The maximum amount of values that can be sent through each type of packet; defaults to 1 for each */
    dataMaxes?: number[];
    /** The minimum amount of values that can be sent through each type of packet; defaults to the max for each */
    dataMins?: number[];
    /** If the values should be kept in an array or spread along the listener; defaults to false */
    dontSpread?: boolean;
    /** A validation function that is called whenever data is received. Return true for success, return false to kick socket. */
    validator?: ((values: any[]) => boolean) | null;
};

/** Settings for single-typed enum packets */
export type EnumPacketSettings = {
    /** The tag of the packet; used for on(packetTag) and send(packetTag) */
    packetTag: string;
    /** The tag of the enum; used for WrapEnum(enumTag) */
    enumTag: string;
    /** The possible values of the enum */
    values: any[];
    /** The maximum amount of values that can be sent through this packet; defaults to 1 */
    dataMax?: number;
    /** The minimum amount of values that can be sent through this packet; defaults to the max */
    dataMin?: number;
    /** If the values should be kept in an array or spread along the listener; defaults to false */
    dontSpread?: boolean;
    /** A validation function that is called whenever data is received. Return true for success, return false to kick socket. */
    validator?: ((values: any[]) => boolean) | null;
}

/**
 * Creates a structure for a simple single-typed packet.
 * This packet can be sent and received with the specified tag, type, and data cap.
 * @param settings The settings object containing `tag`, `type`, `dataMax`, `dataMin`, and `dontSpread`.
 * @returns The constructed packet structure data.
 * @throws {Error} If the `type` is invalid.
 */
export function CreatePacket(settings: SinglePacketSettings): Packet {
    let { tag, type = PacketType.NONE, dataMax = 1, dataMin, dontSpread = false, validator = null } = settings;

    if(dataMin == undefined) dataMin = type == PacketType.NONE ? 0 : dataMax;

    if (!isValidType(type)) {
        throw new Error(`Invalid packet type: ${type}`);
    }

    return new Packet(tag, PacketSchema.single(type, clampDataMax(dataMax), clampDataMin(dataMin, dataMax), dontSpread), validator, false);
}

/**
 * Creates a structure for an object (multi-typed) packet.
 * This packet allows multiple types and their associated data caps.
 * @param settings The settings object containing `tag`, `types`, `dataMaxes`, `dataMins`, and `dontSpread`.
 * @returns The constructed packet structure data.
 * @throws {Error} If any type in `types` is invalid.
 */
export function CreateObjPacket(settings: MultiPacketSettings): Packet {
    let { tag, types, dataMaxes, dataMins, dontSpread = false, validator = null } = settings;

    const invalid = types.find((type) => !isValidType(type));
    if (invalid) {
        throw new Error(`Invalid packet type: ${invalid}`);
    }

    if(dataMaxes == undefined) dataMaxes = Array.from({ length: types.length }).map(_ => 1);
    if(dataMins == undefined) dataMins = Array.from({ length: types.length }).map((_, i) => dataMaxes[i]);

    const clampedDataMaxes = dataMaxes.map(clampDataMax);
    const clampedDataMins = dataMins.map((m, i) => types[i] == PacketType.NONE ? 0 : clampDataMin(m, clampedDataMaxes[i]));

    return new Packet(tag, PacketSchema.object(types, clampedDataMaxes, clampedDataMins, dontSpread), validator, false);
}

/**
 * Creates and defines an enum packet. This can be used to create an enum-based packet
 * with a specific tag and possible values.
 * @param settings The settings object containing `packetTag`, `enumTag`, `strings` (enum values), `dataMax`, `dataMin`, and `dontSpread`.
 * @returns The constructed packet structure data.
 */
export function CreateEnumPacket(settings: EnumPacketSettings): Packet {
    const { packetTag, enumTag, values, dataMax = 1, dataMin = 0, dontSpread = false, validator = null } = settings;

    return CreatePacket({
        tag: packetTag,
        type: DefineEnum(enumTag, values),
        dataMax,
        dataMin,
        dontSpread,
        validator
    });
}