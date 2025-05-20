/*
 * Copyright 2025 Lily (cutelittlelily)
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

import { PacketHolder } from "./PacketHolder";
import { Packet, PacketSchema } from "../../packets/Packets";
import { PacketType } from "../../packets/PacketType";
import { NULL, NEGATIVE_C } from "./CodePointUtil";
import { DefineEnum } from "../enums/EnumHandler";
import { EnumPackage } from "../enums/EnumType";
import { SonicWSConnection } from "../../server/SonicWSConnection";

/**
 * Processes and verifies values into a sendable format
 * @param packets Packet holder
 * @param tag The tag of the packet
 * @param values The values
 * @returns The indexed code, the data, and the packet schema
 */
export function processPacket(packets: PacketHolder, tag: string, values: any[]): [code: string, data: string, packet: Packet] {
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
        
        // something is weird with this
        if(!packet.autoFlatten) {
            const dataMins = (packet.dataMin as number[]);
            const dataMaxes = (packet.dataMax as number[]);
            for(let i=0;i<dataMins.length;i++) {
                // these will be the same length
                if(values[i].length < dataMins[i]) throw new Error(`Section ${i + 1} of packet "${tag}" requires at least ${dataMins[i]} values!`);
                if(values[i].length > dataMaxes[i]) throw new Error(`Section ${i + 1} of packet "${tag}" only allows ${dataMaxes[i]} values!`);
            }
        }
    }

    return [code, values.length > 0 ? packet.processSend(values) : "", packet];
}

/**
 * Calls the listener for a packet with error callback
 * @param listened The listened data
 * @param listeners The listeners to run
 * @param errorCB The callback if something goes wrong
 */
export function listenPacket(listened: string | [any[], boolean], listeners: ((...values: any) => void)[], errorCB: (data: string) => void) {
    // if invalid then ignore it and call back
    if(typeof listened == 'string') return errorCB(listened);
    const [processed, flatten] = listened;

    try {
        if(flatten && Array.isArray(processed)) listeners.forEach(l => l(...processed));
        else listeners.forEach(l => l(processed));
    } catch(err) {
        errorCB(err as string);
    }
}

/** Determines if a type is a valid packet type */
function isValidType(type: any): boolean {
    return (typeof type == 'number' && type in PacketType) || type instanceof EnumPackage;
}

/** Clamps data max between 0 and the NEGATIVE_C^packetDelimitSize */
function clampDataMax(dataMax: number, packetDelimitSize: number = 1) {
    if(dataMax < 0) {
        console.warn(`Having a data maximum below 0 does not do anything!`);
        return 0;
    }
    const max = Math.pow(NEGATIVE_C, packetDelimitSize);
    if(dataMax > max) {
        console.warn(`Only ${max} values can be sent in a single type! Use CreateObjPacket() / largePacket: true if you want to send more.`);
        return max;
    }
    return dataMax;
}
/** Clamps data min between 0 and datamax */
function clampDataMin(dataMin: number, dataMax: number) {
    if(dataMin < 0) {
        console.warn(`Having a data minimum below 0 does not do anything!`);
        return 0;
    }
    // also catches >NEGATIVE_C
    if(dataMin > dataMax) {
        console.warn(`Data minimum can not be higher than the data maximum!`);
        return dataMax;
    }
    return dataMin;
}

/** Valid packet type */
export type ArguableType = PacketType | EnumPackage;

/** Shared packet setting types */
export type SharedPacketSettings = {
    /** The tag of the packet; used for on(tag) and send(tag) */
    tag: string;

    /** If data minimum and data maximum is irrelevant; preferably shouldn't be used on client */
    noDataRange?: boolean;

    /** If the values should be kept in an array or spread along the listener; defaults to false */
    dontSpread?: boolean;

    /**
     * Will batch all sends of this packet for this many milliseconds, and turns it into 1 message. Reduces header & send costs.
     * 
     * Defaults to 0 for no batching.
     * 
     * Each batched packet is counted towards the rate limit.
     */
    dataBatching?: number;
    /** If data batching is on, this will limit the amount of packets that can be batched into one (only effects the client). Defaults to 10. */
    maxBatchSize?: number;

    /** A validation function that is called whenever data is received. Return true for success, return false to kick socket. */
    validator?: ((socket: SonicWSConnection, values: any[]) => boolean) | null;
};

/** Settings for single-typed packets */
export type SinglePacketSettings = SharedPacketSettings & {
    /** The data type of the packet; defaults to PacketType.NONE */
    type?: ArguableType;
    /** The maximum amount of values that can be sent through this packet; defaults to 1 */
    dataMax?: number;
    /** The minimum amount of values that can be sent through this packet; defaults to the max */
    dataMin?: number;
};

/** Settings for multi-typed packets */
export type MultiPacketSettings = SharedPacketSettings & {
    /** The data types of the packet */
    types: ArguableType[];
    /** The maximum amount of values that can be sent through each type of packet; defaults to 1 for each. Non-array will fill all for that amount */
    dataMaxes?: number[] | number;
    /** The minimum amount of values that can be sent through each type of packet; defaults to the max for each Non-array will fill all for that amount */
    dataMins?: number[] | number;
    /** Will automatically run FlattenData() and UnFlattenData() on values; this will optimize [[x,y,z],[x,y,z]...] for wire transfer */
    autoFlatten?: boolean;
    /** If the packet will have values larger than 55,296 then this will allow up to 3,057,647,616 length for some minor bandwidth cost. */
    largePacket?: boolean;
};

/** Settings for single-typed enum packets */
export type EnumPacketSettings = SharedPacketSettings & {
    /** The tag of the enum; used for WrapEnum(enumTag) */
    enumTag: string;
    /** The possible values of the enum */
    values: any[];
    /** The maximum amount of values that can be sent through this packet; defaults to 1 */
    dataMax?: number;
    /** The minimum amount of values that can be sent through this packet; defaults to the max */
    dataMin?: number;
}

/**
 * Creates a structure for a simple single-typed packet.
 * This packet can be sent and received with the specified tag, type, and data cap.
 * @param settings The settings object containing `tag`, `type`, `dataMax`, `dataMin`, `noDataRange`, `dontSpread`, `validator`, `dataBatching`, and/or `maxBatchSize`.
 * @returns The constructed packet structure data.
 * @throws {Error} If the `type` is invalid.
 */
export function CreatePacket(settings: SinglePacketSettings): Packet {
    let { tag, type = PacketType.NONE, dataMax = 1, dataMin, noDataRange = false, dontSpread = false, validator = null, dataBatching = 0, maxBatchSize = 10 } = settings;

    if(noDataRange) {
        dataMin = 0;
        dataMax = NEGATIVE_C;
    } else if(dataMin == undefined) dataMin = type == PacketType.NONE ? 0 : dataMax;

    if (!isValidType(type)) {
        throw new Error(`Invalid packet type: ${type}`);
    }

    return new Packet(tag, PacketSchema.single(type, clampDataMax(dataMax), clampDataMin(dataMin, dataMax), dontSpread, dataBatching, maxBatchSize), validator, false);
}

/**
 * Creates a structure for an object (multi-typed) packet.
 * This packet allows multiple types and their associated data caps.
 * @param settings The settings object containing `tag`, `types`, `dataMaxes`, `dataMins`, `noDataRange`, `dontSpread`, `autoFlatten`, `largePacket`, `validator`, `dataBatching`, and/or `maxBatchSize`.
 * @returns The constructed packet structure data.
 * @throws {Error} If any type in `types` is invalid.
 */
export function CreateObjPacket(settings: MultiPacketSettings): Packet {
    let { tag, types, dataMaxes, dataMins, noDataRange = false, dontSpread = false, autoFlatten = false, largePacket = false, validator = null, dataBatching = 0, maxBatchSize = 10 } = settings;

    const invalid = types.find((type) => !isValidType(type));
    if (invalid) {
        throw new Error(`Invalid packet type: ${invalid}`);
    }

    // if needed, change to largePacket as a number for it to be any
    const packetDelimitSize = largePacket ? 2 : 1;

    if(noDataRange) {
        dataMaxes = Array.from({ length: types.length }).map(() => Math.pow(NEGATIVE_C, packetDelimitSize));
        dataMins = Array.from({ length: types.length }).map(() => 0);
    } else {
        if(dataMaxes == undefined) dataMaxes = Array.from({ length: types.length }).map(() => 1);
        else if (!Array.isArray(dataMaxes)) dataMaxes = Array.from({ length: types.length }).map(() => dataMaxes as number);
        
        if(dataMins == undefined) dataMins = Array.from({ length: types.length }).map((_, i) => (dataMaxes as number[])[i]);
        else if (!Array.isArray(dataMins)) dataMins = Array.from({ length: types.length }).map(() => dataMins as number);
    }

    const clampedDataMaxes = dataMaxes.map(m => clampDataMax(m, packetDelimitSize));
    const clampedDataMins = dataMins.map((m, i) => types[i] == PacketType.NONE ? 0 : clampDataMin(m, clampedDataMaxes[i]));

    // largepacket could be turned bigger if i ever need it, and this'll be easier impl anyway
    return new Packet(tag, PacketSchema.object(types, clampedDataMaxes, clampedDataMins, dontSpread, autoFlatten, packetDelimitSize, dataBatching, maxBatchSize), validator, false);
}

/**
 * Creates and defines an enum packet. This can be used to create an enum-based packet
 * with a specific tag and possible values.
 * @param settings The settings object containing `tag`, `enumTag`, `values`, `dataMax`, `dataMin`, `noDataRange`, `dontSpread`, `validator`, `dataBatching`, and/or `maxBatchSize`.
 * @returns The constructed packet structure data.
 */
export function CreateEnumPacket(settings: EnumPacketSettings): Packet {
    const { tag, enumTag, values, dataMax = 1, dataMin = 0, noDataRange = false, dontSpread = false, validator = null, dataBatching = 0, maxBatchSize = 10 } = settings;

    return CreatePacket({
        tag: tag,
        type: DefineEnum(enumTag, values),
        dataMax,
        dataMin,
        noDataRange,
        dontSpread,
        validator,
        dataBatching,
        maxBatchSize,
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