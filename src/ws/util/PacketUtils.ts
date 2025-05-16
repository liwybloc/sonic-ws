import { PacketHolder } from "./PacketHolder";
import { Packet, PacketSchema } from "../packets/Packets";
import { PacketType } from "../packets/PacketType";
import { NULL, MAX_C } from "./CodePointUtil";
import { DefineEnum } from "../enums/EnumHandler";
import { EnumPackage } from "../enums/EnumType";

export function emitPacket(packets: PacketHolder, send: (data: string) => void, tag: string, values: any[]) {
    const time = process.hrtime.bigint();

    const code = packets.getChar(tag);
    if(code == NULL) throw new Error(`Tag "${tag}" has not been created!`);

    const packet = packets.getPacket(tag);

    if(packet.autoFlatten) {
        values = FlattenData(values[0]);
    } else {
        if(values.length > packet.maxSize) throw new Error(`Packet "${tag}" only allows ${packet.maxSize} values!`);
        if(values.length < packet.minSize) throw new Error(`Packet "${tag}" requires at least ${packet.minSize} values!`);
    }

    if(!packet.object) {
        const found = values.find(v => typeof v == 'object' && v != null);
        if(found) console.warn(`Passing an array will result in undefined behavior (${JSON.stringify(found)}). Spread the array with ...arr`);
    } else {
        // also map non arrays to arrays to keep some code cleaner
        values = values.map(x => !Array.isArray(x) ? [x] : x);
        
        const dataMins = (packet.dataMin as number[]);
        const dataMaxes = (packet.dataMax as number[]);
        for(let i=0;i<dataMins.length;i++) {
            // these will be the same length
            if(values[i].length < dataMins[i]) throw new Error(`Section ${i + 1} of packet "${tag}" requires at least ${dataMins[i]} values!`);
            if(values[i].length > dataMaxes[i]) throw new Error(`Section ${i + 1} of packet "${tag}" only allows ${dataMaxes[i]} values!`);
        }
    }

    send(code + (values.length > 0 ? packet.processSend(values) : ""));

    console.log("Send processing time: " + (Number(process.hrtime.bigint() - time) / 1_000_000) + "ms");
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
    /** If data minimum and data maximum is irrelevant; preferably shouldn't be used on client */
    noDataRange?: boolean;

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

    /** The maximum amount of values that can be sent through each type of packet; defaults to 1 for each. Non-array will fill all for that amount */
    dataMaxes?: number[] | number;
    /** The minimum amount of values that can be sent through each type of packet; defaults to the max for each Non-array will fill all for that amount */
    dataMins?: number[] | number;
    /** If data minimum and data maximum is irrelevant; preferably shouldn't be used on client */
    noDataRange?: boolean;

    /** If the values should be kept in an array or spread along the listener; defaults to false */
    dontSpread?: boolean;
    /** Will automatically run FlattenData() and UnFlattenData() on values; this will optimize [[x,y,z],[x,y,z]...] for wire transfer */
    autoFlatten?: boolean;

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

    /** If data minimum and data maximum is irrelevant; preferably shouldn't be used on client */
    noDataRange?: boolean;
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
    let { tag, type = PacketType.NONE, dataMax = 1, dataMin, noDataRange = false, dontSpread = false, validator = null } = settings;

    if(noDataRange) {
        dataMin = 0;
        dataMax = MAX_C;
    } else if(dataMin == undefined) dataMin = type == PacketType.NONE ? 0 : dataMax;

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
    let { tag, types, dataMaxes, dataMins, noDataRange = false, dontSpread = false, autoFlatten = false, validator = null } = settings;

    const invalid = types.find((type) => !isValidType(type));
    if (invalid) {
        throw new Error(`Invalid packet type: ${invalid}`);
    }

    if(noDataRange) {
        dataMaxes = Array.from({ length: types.length }).map(() => MAX_C);
        dataMins = Array.from({ length: types.length }).map(() => 0);
    } else {
        if(dataMaxes == undefined) dataMaxes = Array.from({ length: types.length }).map(() => 1);
        else if (!Array.isArray(dataMaxes)) dataMaxes = Array.from({ length: types.length }).map(() => dataMaxes as number);
        
        if(dataMins == undefined) dataMins = Array.from({ length: types.length }).map((_, i) => (dataMaxes as number[])[i]);
        else if (!Array.isArray(dataMins)) dataMins = Array.from({ length: types.length }).map(() => dataMins as number);
    }

    const clampedDataMaxes = dataMaxes.map(clampDataMax);
    const clampedDataMins = dataMins.map((m, i) => types[i] == PacketType.NONE ? 0 : clampDataMin(m, clampedDataMaxes[i]));

    return new Packet(tag, PacketSchema.object(types, clampedDataMaxes, clampedDataMins, dontSpread, autoFlatten), validator, false);
}

/**
 * Creates and defines an enum packet. This can be used to create an enum-based packet
 * with a specific tag and possible values.
 * @param settings The settings object containing `packetTag`, `enumTag`, `strings` (enum values), `dataMax`, `dataMin`, and `dontSpread`.
 * @returns The constructed packet structure data.
 */
export function CreateEnumPacket(settings: EnumPacketSettings): Packet {
    const { packetTag, enumTag, values, dataMax = 1, dataMin = 0, noDataRange = false, dontSpread = false, validator = null } = settings;

    return CreatePacket({
        tag: packetTag,
        type: DefineEnum(enumTag, values),
        dataMax,
        dataMin,
        noDataRange,
        dontSpread,
        validator
    });
}

/**
 * Flattens a 2-depth array for efficient wire transfer
 * Turns [[x,y,z],[x,y,z]...] to [[x,x...],[y,y...],[z,z...]]
 * @param array A 2-depth array of multi-valued
 */
export function FlattenData(arr: any[][]): any[][] {
    return arr[0]?.map((_, i) => arr.map(row => row[i])) ?? [];
}

/**
 * Unflattens an array into 2-depth; reverse of FlattenData()
 * turns [[x,x...],[y,y...],[z,z...]] to [[x,y,z],[x,y,z]...]
 * @param array A flattened array
 */
export function UnFlattenData(arr: any[][]): any[][] {
    return arr[0]?.map((_, i) => arr.map(col => col[i])) ?? [];
}