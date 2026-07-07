/*
 * Copyright (c) 2026 Lily (liwybloc)
 *
 * Licensed for personal, non-commercial use only.
 * Commercial use, redistribution, sublicensing, sale, rental, lease,
 * or inclusion in a paid product or service is prohibited without prior
 * written permission from the copyright holder.
 *
 * See the LICENSE file in the project root for the full license terms.
 *
 * License-Identifier: LicenseRef-Lily-Personal-NonCommercial-2026
 */

import { PacketHolder } from "./PacketHolder";
import { ConvertType, Packet, PacketSchema, ValidatorFunction } from "../../packets/Packets";
import { PacketType } from "../../packets/PacketType";
import { EnumPackage } from "../enums/EnumType";
import { EMPTY_UINT8, MAX_USHORT } from "./CompressionUtil";
import { SendQueue } from "../../PacketProcessor";
import { hashValue } from "./HashUtil";
import { PacketConstructor, RegisterPacketConstructor } from "./metadata/ConstructorRegistry";
import { VariantPermutation } from "./VariantPermutation";

export type ProcessedPacket = [code: number, data: Uint8Array, packet: Packet<any>];

/**
 * Processes and verifies values into a sendable format.
 * @param packets packet holder
 * @param tag packet tag
 * @param values application values
 * @returns indexed code, encoded data, and packet schema
 * @internal
 */
export async function processPacket(
    packets: PacketHolder,
    tag: string,
    values: any[],
    sendQueue: SendQueue,
    id: number,
    force: boolean = false,
): Promise<ProcessedPacket> {
    const code = packets.getKey(tag);
    const packet = packets.getPacket(tag);

    return handleQueue(sendQueue, packets, id, tag, values, force, async () => {
        if (packet.rereference) {
            if (id === -1) {
                throw new Error("Cannot send a re-referenced packet from the server-wide sender");
            }

            const serialized = hashValue(values);
            if (packet.lastSent[id] === serialized) {
                return [code, EMPTY_UINT8, packet];
            }

            packet.lastSent[id] = serialized;
        }

        values = packet.prepareSend(values, id);

        if (packet.autoFlatten && packet.object && !packet.fields) {
            values = FlattenData(values[0]);
        } else {
            if (values.length > packet.maxSize) {
                throw new Error(`Packet "${tag}" only allows ${packet.maxSize} values`);
            }
            if (values.length < packet.minSize) {
                throw new Error(`Packet "${tag}" requires at least ${packet.minSize} values`);
            }
        }

        if (!packet.object && packet.type !== PacketType.JSON) {
            const nestedValue = values.find(value => typeof value === "object" && value != null);
            if (nestedValue) {
                console.warn(
                    `Passing a nested value may produce undefined behavior (${JSON.stringify(nestedValue)}). `
                    + "Spread arrays into positional packet arguments",
                );
            }
        } else if (packet.object) {
            values = values.map(value => Array.isArray(value) ? value : [value]);

            if (!packet.autoFlatten) {
                const dataMins = packet.dataMin as number[];
                const dataMaxes = packet.dataMax as number[];

                for (let index = 0; index < dataMins.length; index++) {
                    if (values[index].length < dataMins[index]) {
                        throw new Error(
                            `Section ${index + 1} of packet "${tag}" requires at least ${dataMins[index]} values`,
                        );
                    }
                    if (values[index].length > dataMaxes[index]) {
                        throw new Error(
                            `Section ${index + 1} of packet "${tag}" only allows ${dataMaxes[index]} values`,
                        );
                    }
                }
            }
        }

        let sendData: Uint8Array = EMPTY_UINT8;
        if (values.length > 0) {
            const encoded = packet.processSend(values);
            sendData = encoded instanceof Promise ? await encoded : encoded;
        }
        return [code, sendData, packet];
    });
}

/**
 * @internal
 */
async function handleQueue(
    sendQueue: SendQueue,
    packets: PacketHolder,
    id: number,
    tag: string,
    values: any[],
    force: boolean,
    fn: () => Promise<ProcessedPacket>
): Promise<ProcessedPacket> {
    if (sendQueue[0] && !force) {
        return new Promise<ProcessedPacket>((resolve) => sendQueue[1].push([resolve, tag, values]));
    }

    sendQueue[0] = true;
    const result = await fn();

    if (sendQueue[1].length > 0) {
        const [resolve, nextTag, nextValues] = sendQueue[1].shift()!;
        queueMicrotask(async () => {
            resolve(await processPacket(packets, nextTag, nextValues, sendQueue, id, true));
        });
    } else {
        sendQueue[0] = false;
    }

    return result;
}


/**
 * Calls packet listeners and reports listener failures.
 * @param listened processed packet data
 * @param listeners listeners to run
 * @param errorCB callback used when processing fails
 * @internal
 */
export async function listenPacket(
    listened: string | [any[], boolean],
    listeners: ((...values: any) => void | Promise<void>)[],
    errorCB: (data: string) => void,
): Promise<void> {
    if (typeof listened === "string") {
        errorCB(listened);
        return;
    }

    const [processed, flatten] = listened;

    try {
        if (flatten && Array.isArray(processed)) {
            for (const listener of listeners) {
                await listener(...processed);
            }
        } else {
            for (const listener of listeners) {
                await listener(processed);
            }
        }
    } catch (error) {
        console.error(error);
        errorCB(String(error));
    }
}

/**
 * Checks whether a value is a supported packet type.
 * @param type possible packet type
 * @internal
 */
function isInvalidType(type: unknown): boolean {
    return !(typeof type === "number" && type in PacketType) && !(type instanceof EnumPackage);
}

const MAX_DATA_MAX = 2048383;

/** Clamps data max between zero and the protocol limit. @internal */
function clampDataMax(dataMax: number): number {
    if (dataMax < 0) {
        console.warn("A data maximum below zero is treated as zero");
        return 0;
    }

    if (dataMax > MAX_DATA_MAX) {
        console.warn(`A packet type can contain at most ${MAX_DATA_MAX} values`);
        return MAX_DATA_MAX;
    }

    return dataMax;
}

/** Clamps data min between zero and data max. @internal */
function clampDataMin(dataMin: number, dataMax: number): number {
    if (dataMin < 0) {
        console.warn("A data minimum below zero is treated as zero");
        return 0;
    }

    if (dataMin > dataMax) {
        console.warn("A data minimum above the data maximum is clamped to the maximum");
        return dataMax;
    }

    return dataMin;
}

/** Normalizes a two-byte per-second rate limit; zero means unlimited. @internal */
function clampRateLimit(rateLimit: number): number {
    if (!Number.isFinite(rateLimit) || rateLimit < 0)
        throw new Error("Rate limit must be a non-negative finite number");
    rateLimit = Math.floor(rateLimit);
    if (rateLimit > MAX_USHORT) {
        console.warn(`A rate limit above ${MAX_USHORT} is considered infinite.`);
        return 0;
    }
    return rateLimit;
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
    /**
     * Limits packets in one batch on the receiving client.
     * Defaults to 10. Zero disables the limit.
     */
    maxBatchSize?: number;

    /** The amount of times this packet can be sent every second, or 0 for infinite. */
    rateLimit?: number;

    /**
     * If the packet should be enabled by default. Defaults to true. Will kick the client if they send a disabled packet. Does not effect server.
     * 
     * Changeable with socket.enablePacket("tag") | socket.disablePacket("tag") (you can also do wss.enablePacket/disablePacket).
     */
    enabled?: boolean;

    /** A validation function that is called whenever data is received. Return true for success, return false to kick socket. */
    validator?: ValidatorFunction;

    /**
     * Allows other packet types to run while this packet is processing.
     * Repeated calls for this packet remain serialized.
     */
    async?: boolean;

    /** If this is true, the packet will be Gzip compressed. Defaults to false on all types but JSON. */
    gzipCompression?: boolean;
    /** Retain this server-to-client packet briefly for connection-state recovery. */
    replay?: boolean;
};

/** Settings for single-typed packets */
export type SinglePacketSettings = SharedPacketSettings & {
    /** The data type of the packet; defaults to PacketType.NONE */
    type?: ArguableType;
    /** The maximum amount of values that can be sent through this packet; defaults to 1 */
    dataMax?: number;
    /** The minimum amount of values that can be sent through this packet; defaults to the max */
    dataMin?: number;
    /**
     * Reuses the previous value when an empty payload arrives.
     * This is incompatible with a zero data minimum.
     */
    rereference?: boolean;
    /** Field names used to map positional values to and from an object. */
    schema?: readonly string[];
    /** Treat one array of records as fixed-width row-major data. Requires schema. */
    autoFlatten?: boolean;
    /** Packet-level numeric quantization. trackError defaults to true and enables per-connection error feedback. */
    quantized?: { scale: number; trackError?: boolean };
    /** Inclusive application-level numeric minimum. */
    min?: number;
    /** Inclusive application-level numeric maximum. */
    max?: number;
    /**
     * Constructs decoded schema fields with a local class.
     * Peers exchange the class name and register their own matching class.
     */
    constructor?: Function;
};

/** Settings for multi-typed packets */
export type MultiPacketSettings = SharedPacketSettings & {
    /** The data types of the packet */
    readonly types: readonly ArguableType[];
    /** Sets the maximum value count per field. A scalar applies to every field. */
    dataMaxes?: number[] | number;
    /** Sets the minimum value count per field. A scalar applies to every field. */
    dataMins?: number[] | number;
    /** Transposes repeated rows into columns before encoding. */
    autoFlatten?: boolean;
    /** Field names for records transposed into object-packet columns. */
    schema?: readonly string[];
    /** Column-major repeated-record mapping. autoFlatten remains a deprecated alias. */
    autoTranspose?: boolean;
    /** Local class constructed for every decoded schema record. */
    constructor?: Function;
};

type PacketGroupVariant = Omit<SinglePacketSettings, "tag">;
type PacketGroupDefaults = {
    /** Settings inherited by every variant. Individual variant settings take precedence. */
    defaults?: PacketGroupVariant;
    /** Deprecated alias for `defaults`. */
    delegate?: PacketGroupVariant;
};

export type PacketGroupSettings = {
    tag: string;
} & PacketGroupDefaults & (
    | { variants: Record<string, PacketGroupVariant> }
    | { variants: readonly string[]; defaults: PacketGroupVariant }
    | { variants: readonly string[]; delegate: PacketGroupVariant }
    | { variants: VariantPermutation; defaults: PacketGroupVariant }
    | { variants: VariantPermutation; delegate: PacketGroupVariant }
);

type GroupMetadata = { parent: string; variant: string; isParent: boolean; permutation?: string[] };

/** Settings for single-typed enum packets */
export type EnumPacketSettings = SharedPacketSettings & {
    /** The tag of the enum; used for WrapEnum(enumTag) */
    enumData: EnumPackage;
    /** The maximum amount of values that can be sent through this packet; defaults to 1 */
    dataMax?: number;
    /** The minimum amount of values that can be sent through this packet; defaults to the max */
    dataMin?: number;
}


/**
 * Creates a structure for a simple single-typed packet.
 * This packet can be sent and received with the specified tag, type, and data cap.
 * @param settings Packet type, limits, mapping, validation, and batching settings.
 * @returns The constructed packet structure data.
 * @throws {Error} If the `type` is invalid.
 */
export function CreatePacket<T extends ArguableType>(
    settings: SinglePacketSettings & { type?: T; _group?: GroupMetadata },
): Packet<ConvertType<T>> {
    const repeatedDefaultRange = settings.autoFlatten === true
        && settings.dataMax === undefined
        && settings.dataMin === undefined;
    const packetConstructor = Object.prototype.hasOwnProperty.call(settings, "constructor")
        ? settings.constructor as PacketConstructor
        : undefined;

    let {
        tag,
        type = PacketType.NONE,
        dataMax = 1,
        dataMin,
        noDataRange = false,
        dontSpread = false,
        validator = null,
        dataBatching = 0,
        maxBatchSize = 10,
        rateLimit = 0,
        enabled = true,
        async = false,
        gzipCompression = type === PacketType.JSON,
        rereference = false,
        schema: fields,
        autoFlatten = false,
        quantized,
        min,
        max,
    } = settings;

    if (!tag) throw new Error("Packet tag is required");

    if (noDataRange || repeatedDefaultRange) {
        dataMin = rereference ? 1 : 0;
        dataMax = MAX_DATA_MAX;
    } else if (dataMin === undefined) {
        dataMin = type === PacketType.NONE ? 0 : dataMax;
    }

    if (rereference && dataMin === 0) {
        throw new Error("Rereference requires a data minimum above zero");
    }
    if (settings.replay && dataBatching) {
        throw new Error(`Packet "${tag}" cannot combine replay with batching`);
    }

    if (isInvalidType(type)) {
        throw new Error(`Invalid packet type: ${type}`);
    }

    validateFields(fields, tag);
    if (packetConstructor && !fields) {
        throw new Error(`Packet "${tag}" constructor requires schema`);
    }
    if (packetConstructor) {
        RegisterPacketConstructor(packetConstructor);
    }
    if (autoFlatten && (!fields || fields.length === 0)) {
        throw new Error(`Packet "${tag}" autoFlatten requires schema`);
    }
    if (fields && !autoFlatten && dataMin === dataMax && fields.length !== dataMax) {
        throw new Error(`Packet "${tag}" schema length must match its fixed value count (${dataMax})`);
    }

    validateNumericOptions(type, quantized, min, max, tag);

    const schema = new PacketSchema<PacketType>(
        false,
        type,
        async,
        clampDataMin(dataMin, dataMax),
        clampDataMax(dataMax),
        clampRateLimit(rateLimit),
        dontSpread,
        autoFlatten,
        rereference,
        dataBatching,
        maxBatchSize,
        gzipCompression,
        fields,
        quantized,
        min,
        max,
        settings._group,
        packetConstructor?.name,
        settings.replay ?? false,
    );

    return new Packet<ConvertType<T>>(tag, schema, validator, enabled, false);
}

/**
 * Creates a structure for an object (multi-typed) packet.
 * This packet allows multiple types and their associated data caps.
 * @param settings Field types, limits, transposition, validation, and batching settings.
 * @returns The constructed packet structure data.
 * @throws {Error} If any type in `types` is invalid.
 */
export function CreateObjPacket<
    T extends readonly ArguableType[],
    V extends readonly PacketType[] = { [K in keyof T]: ConvertType<T[K]> },
>(
    settings: MultiPacketSettings & { readonly types: T },
): Packet<V> {
    const packetConstructor = Object.prototype.hasOwnProperty.call(settings, "constructor")
        ? settings.constructor as PacketConstructor
        : undefined;

    let {
        tag,
        types = [],
        dataMaxes,
        dataMins,
        noDataRange = false,
        dontSpread = false,
        autoFlatten = false,
        autoTranspose,
        schema: fields,
        validator = null,
        dataBatching = 0,
        maxBatchSize = 10,
        rateLimit = 0,
        enabled = true,
        async = false,
        gzipCompression = types && (types as ArguableType[]).includes(PacketType.JSON),
    } = settings;

    if (!tag) throw new Error("Packet tag is required");
    if (!types || types.length === 0) throw new Error(`Packet "${tag}" requires at least one type`);
    if (settings.replay && dataBatching) throw new Error(`Packet "${tag}" cannot combine replay with batching`);
    validateFields(fields, tag);
    if (packetConstructor && !fields) throw new Error(`Packet "${tag}" constructor requires schema`);
    if (packetConstructor) {
        RegisterPacketConstructor(packetConstructor);
    }
    if (fields && fields.length !== types.length) throw new Error(`Packet "${tag}" schema length must match types length`);
    if (autoTranspose !== undefined && autoFlatten && autoTranspose !== autoFlatten)
        throw new Error(`Packet "${tag}" has conflicting autoFlatten and autoTranspose options`);
    const transpose = autoTranspose ?? autoFlatten;

    for (const type of types) {
        if (!isInvalidType(type)) continue;
        throw new Error(`Invalid packet type in "${tag}" packet: ${type}`);
    }

    if (noDataRange) {
        dataMaxes = Array.from({ length: types.length }, () => MAX_DATA_MAX);
        dataMins = Array.from({ length: types.length }, () => 0);
    } else {
        if (dataMaxes === undefined) {
            dataMaxes = Array.from({ length: types.length }, () => 1);
        } else if (!Array.isArray(dataMaxes)) {
            dataMaxes = Array.from({ length: types.length }, () => dataMaxes as number);
        }
        
        if (dataMins === undefined) {
            const maximums = dataMaxes as number[];
            dataMins = Array.from({ length: types.length }, (_, index) => maximums[index]);
        } else if (!Array.isArray(dataMins)) {
            dataMins = Array.from({ length: types.length }, () => dataMins as number);
        }
    }

    const normalizedDataMaxes = dataMaxes as number[];
    const normalizedDataMins = dataMins as number[];
    const clampedDataMaxes = normalizedDataMaxes.map(clampDataMax);
    const clampedDataMins = normalizedDataMins.map((minimum, index) =>
        types[index] === PacketType.NONE ? 0 : clampDataMin(minimum, clampedDataMaxes[index]));

    const schema = new PacketSchema<readonly PacketType[]>(
        true,
        types as any,
        async,
        clampedDataMins,
        clampedDataMaxes,
        clampRateLimit(rateLimit),
        dontSpread,
        transpose,
        false,
        dataBatching,
        maxBatchSize,
        gzipCompression,
        fields,
        undefined,
        undefined,
        undefined,
        undefined,
        packetConstructor?.name,
        settings.replay ?? false,
    );

    return new Packet<V>(tag, schema, validator, enabled, false);
}

/**
 * Creates a parent packet and its named variants as ordinary packet definitions.
 *
 * A group named `movement` with `look`, `move`, and `both` variants returns four
 * packets: `movement` (`PacketType.NONE`), `movement.look`, `movement.move`, and
 * `movement.both`. Spread the returned array into `clientPackets` or
 * `serverPackets`. Send a child with `sendVariant("movement", "move", value)`;
 * listeners on `movement.move` receive the child payload, while listeners on
 * `movement` also receive `{ variant: "move", payload }`. Sending `movement`
 * directly represents the parent/empty variant (`variant: ""`).
 *
 * `defaults` applies shared settings before each variant override. Array variants
 * require `defaults`, for example `{ variants: ["W", "A"], defaults: { type:
 * PacketType.SHORTS } }`. `delegate` remains accepted as a deprecated alias.
 */
export function CreatePacketGroup(settings: PacketGroupSettings): Packet<any>[] {
    if (!settings.tag || settings.tag.includes("$")) {
        throw new Error("Packet group tag is required and cannot contain '$'");
    }

    if (settings.defaults !== undefined && settings.delegate !== undefined) {
        throw new Error(`Packet group "${settings.tag}" cannot define both defaults and delegate`);
    }

    const defaults = settings.defaults ?? settings.delegate;
    const permutation = settings.variants instanceof VariantPermutation ? settings.variants : undefined;
    if ((Array.isArray(settings.variants) || permutation) && defaults === undefined) {
        throw new Error(`Packet group "${settings.tag}" array variants require defaults`);
    }

    const entries: Array<[string, PacketGroupVariant]> = permutation
        ? permutation.generate().map(variant => [variant, {}])
        : Array.isArray(settings.variants)
            ? settings.variants.map(variant => [variant, {}])
            : Object.entries(settings.variants as Record<string, PacketGroupVariant>);
    if (!entries.length) {
        throw new Error(`Packet group "${settings.tag}" requires at least one variant`);
    }
    if (new Set(entries.map(([variant]) => variant)).size !== entries.length) {
        throw new Error(`Packet group "${settings.tag}" contains duplicate variant names`);
    }

    const parent = CreatePacket({
        tag: settings.tag,
        type: PacketType.NONE,
        dataMin: 0,
        dataMax: 0,
        _group: { parent: settings.tag, variant: "", isParent: true, permutation: permutation?.getValues() },
    });

    const children = entries.map(([variant, definition]) => {
        if (typeof variant !== "string" || !variant || variant.includes("$")) {
            throw new Error("Packet variant names cannot be empty or contain '$'");
        }

        return CreatePacket({
            ...defaults,
            ...definition,
            tag: `${settings.tag}.${variant}`,
            _group: { parent: settings.tag, variant, isParent: false, permutation: permutation?.getValues() },
        } as SinglePacketSettings & { _group: GroupMetadata });
    });

    return [parent, ...children];
}

function validateFields(fields: readonly string[] | undefined, tag: string): void {
    if (!fields) return;

    if (!fields.length || fields.some(field => typeof field !== "string" || !field)) {
        throw new Error(`Packet "${tag}" schema must contain non-empty field names`);
    }
    if (new Set(fields).size !== fields.length) {
        throw new Error(`Packet "${tag}" schema fields must be unique`);
    }
}

const NUMERIC_TYPES = new Set<ArguableType>([
    PacketType.BYTES,
    PacketType.UBYTES,
    PacketType.SHORTS,
    PacketType.USHORTS,
    PacketType.VARINT,
    PacketType.UVARINT,
    PacketType.DELTAS,
    PacketType.FLOATS,
    PacketType.DOUBLES,
]);

function validateNumericOptions(
    type: ArguableType,
    quantized: { scale: number } | undefined,
    min: number | undefined,
    max: number | undefined,
    tag: string,
): void {
    if (min !== undefined && max !== undefined && min > max) {
        throw new Error(`Packet "${tag}" min cannot exceed max`);
    }
    if ((quantized || min !== undefined || max !== undefined) && !NUMERIC_TYPES.has(type)) {
        throw new Error(`Packet "${tag}" numeric options require a numeric packet type`);
    }
    if (quantized && (!Number.isFinite(quantized.scale) || quantized.scale <= 0)) {
        throw new Error(`Packet "${tag}" quantization scale must be positive and finite`);
    }
}

/**
 * Creates and defines an enum packet. This can be used to create an enum-based packet
 * with a specific tag and possible values.
 * @param settings Enum package, limits, validation, and batching settings.
 * @returns The constructed packet structure data.
 */
export function CreateEnumPacket(settings: EnumPacketSettings): Packet<PacketType.ENUMS> {
    const {
        tag,
        enumData,
        dataMax = 1,
        dataMin = 0,
        noDataRange = false,
        dontSpread = false,
        validator = null,
        dataBatching = 0,
        maxBatchSize = 10,
        rateLimit = 0,
        enabled = true,
        async = false,
    } = settings;

    return CreatePacket({
        tag,
        type: enumData,
        dataMax,
        dataMin,
        noDataRange,
        dontSpread,
        validator,
        dataBatching,
        maxBatchSize,
        rateLimit,
        enabled,
        async,
    });
}

/**
 * Flattens a 2-depth array for efficient wire transfer
 * Turns [[x,y,z],[x,y,z]...] to [[x,x...],[y,y...],[z,z...]]
 * @param array A 2-depth array of multi-valued
 */
export function FlattenData(arr: any[][]): any[][] {
    if (arr == null) return [];

    const firstRow = arr[0];
    if (firstRow == null) return [];
    if (!Array.isArray(firstRow)) throw new Error(`Cannot flatten array: ${arr}`);

    return firstRow.map((_, index) => arr.map(row => row[index]));
}

/**
 * Unflattens an array into 2-depth; reverse of FlattenData()
 * turns [[x,x...],[y,y...],[z,z...]] to [[x,y,z],[x,y,z]...]
 * @param array A flattened array
 */
export function UnFlattenData(arr: any[][]): any[][] {
    return arr[0]?.map((_, index) => arr.map(column => column[index])) ?? [];
}
