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

export type AnyPacket = Packet<any, any>;

export type PacketArray = readonly AnyPacket[];

type PrimitiveReceive<T> =
    T extends PacketType.NONE ? undefined :
    T extends PacketType.RAW ? Uint8Array :
    T extends PacketType.JSON ? any :
    T extends PacketType.STRINGS_ASCII | PacketType.STRINGS_UTF16 ? string :
    T extends PacketType.BOOLEANS ? boolean :
    T extends PacketType.HEX ? string :
    T extends PacketType.ENUMS ? any :
    T extends PacketType ? number :
    T extends EnumPackage ? any :
    any;

type PrimitiveSend<T> =
    T extends PacketType.NONE ? never :
    T extends PacketType.RAW ? number | Uint8Array :
    T extends PacketType.JSON ? any :
    T extends PacketType.STRINGS_ASCII | PacketType.STRINGS_UTF16 ? string :
    T extends PacketType.BOOLEANS ? boolean :
    T extends PacketType.HEX ? string :
    T extends PacketType.ENUMS ? any :
    T extends PacketType ? number :
    T extends EnumPackage ? any :
    any;

type FieldObject<Fields extends readonly string[], Value> = {
    [K in Fields[number]]: Value;
};

type SettingPacketType<S> = S extends { type: infer T extends ArguableType } ? T : PacketType.NONE;
type SettingFields<S> = S extends { schema: infer Fields extends readonly string[] } ? Fields : never;
type SettingAutoFlatten<S> = S extends { autoFlatten: true } ? true : false;
type SettingDontSpread<S> = S extends { dontSpread: true } ? true : false;

type SingleReceive<S> =
    S extends { _group: infer G extends GroupMetadata }
        ? G["isParent"] extends true
            ? { variant: ""; payload: undefined; permutation?: Record<string, boolean> }
            : SingleReceivePayload<S>
        : SingleReceivePayload<S>;

type SingleReceivePayload<S> =
    [SettingFields<S>] extends [never]
        ? PrimitiveReceive<SettingPacketType<S>>
        : SettingAutoFlatten<S> extends true
            ? Array<FieldObject<SettingFields<S>, PrimitiveReceive<SettingPacketType<S>>>>
            : FieldObject<SettingFields<S>, PrimitiveReceive<SettingPacketType<S>>>;

type SingleSendArgs<S> =
    SettingPacketType<S> extends PacketType.NONE
        ? []
        : [SettingFields<S>] extends [never]
            ? PrimitiveSend<SettingPacketType<S>>[]
            : SettingAutoFlatten<S> extends true
                ? [Array<FieldObject<SettingFields<S>, PrimitiveSend<SettingPacketType<S>>>>]
                : [FieldObject<SettingFields<S>, PrimitiveSend<SettingPacketType<S>>>];

type SingleListenerArgs<S> =
    SettingDontSpread<S> extends true
        ? [SingleReceive<S>]
        : [SettingFields<S>] extends [never]
            ? SettingPacketType<S> extends PacketType.NONE
                ? [undefined]
                : PrimitiveReceive<SettingPacketType<S>>[]
            : [SingleReceive<S>];

type ObjFields<S> = S extends { schema: infer Fields extends readonly string[] } ? Fields : never;
type ObjReceive<S> =
    [ObjFields<S>] extends [never]
        ? any[]
        : S extends { autoTranspose: true } | { autoFlatten: true }
            ? Array<FieldObject<ObjFields<S>, any>>
            : FieldObject<ObjFields<S>, any>;
type ObjSendArgs<S> =
    [ObjFields<S>] extends [never]
        ? any[]
        : S extends { autoTranspose: true } | { autoFlatten: true }
            ? [Array<FieldObject<ObjFields<S>, any>>]
            : [FieldObject<ObjFields<S>, any>];
type ObjListenerArgs<S> = [ObjReceive<S>];

export type TypedPacket<
    Tag extends string,
    Receive,
    SendArgs extends readonly any[],
    ListenerArgs extends readonly any[],
    Parent extends string | undefined = undefined,
    Variant extends string | undefined = undefined,
> = AnyPacket & {
    readonly tag: Tag;
    readonly __sonicTypes: {
        readonly receive: Receive;
        readonly sendArgs: SendArgs;
        readonly listenerArgs: ListenerArgs;
        readonly parent: Parent;
        readonly variant: Variant;
    };
};

export type TypedSinglePacket<S extends {
    tag: string;
    type?: ArguableType;
    schema?: readonly string[] | undefined;
    autoFlatten?: boolean | undefined;
    dontSpread?: boolean | undefined;
    _group?: GroupMetadata;
}> = TypedPacket<
    S["tag"],
    SingleReceive<S>,
    SingleSendArgs<S>,
    SingleListenerArgs<S>,
    S extends { _group: infer G extends GroupMetadata } ? G["parent"] : undefined,
    S extends { _group: infer G extends GroupMetadata } ? G["variant"] : undefined
>;

export type TypedObjPacket<S extends MultiPacketSettings> = TypedPacket<
    S["tag"],
    ObjReceive<S>,
    ObjSendArgs<S>,
    ObjListenerArgs<S>
>;

export type PacketTags<Packets extends readonly AnyPacket[]> = Extract<Packets[number]["tag"], string>;

export type PacketByTag<
    Packets extends readonly AnyPacket[],
    Tag extends string,
> = Extract<Packets[number], { readonly tag: Tag }>;

export type PacketReceive<P> = P extends { readonly __sonicTypes: { readonly receive: infer T } } ? T : any;
export type PacketSendArgs<P> = P extends { readonly __sonicTypes: { readonly sendArgs: infer T extends readonly any[] } } ? T : any[];
export type PacketListenerArgs<P> = P extends { readonly __sonicTypes: { readonly listenerArgs: infer T extends readonly any[] } } ? T : any[];

export type PacketGroupEvent<
    Packets extends readonly AnyPacket[],
    Parent extends string,
> = Packets[number] extends infer P
    ? P extends { readonly __sonicTypes: { readonly parent: Parent; readonly variant: infer V extends string } }
        ? { variant: V; payload: PacketReceive<P>; permutation?: Record<string, boolean> }
        : never
    : never;

export type PacketListener<
    Packets extends readonly AnyPacket[],
    Tag extends PacketTags<Packets>,
> = (...values: PacketListenerArgs<PacketByTag<Packets, Tag>>) => void | Promise<void>;

export type PacketSendValues<
    Packets extends readonly AnyPacket[],
    Tag extends PacketTags<Packets>,
> = PacketSendArgs<PacketByTag<Packets, Tag>>;

export type SonicPacketTypeEntry = {
    readonly sendArgs: readonly any[];
    readonly listenerArgs: readonly any[];
    readonly receive: any;
};

export type SonicPacketTypeMap = Record<string, SonicPacketTypeEntry>;

export type SonicProtocolTypes = {
    readonly client: SonicPacketTypeMap;
    readonly server: SonicPacketTypeMap;
};

export type ProtocolPacketTags<
    Protocol extends SonicProtocolTypes,
    Direction extends keyof SonicProtocolTypes,
> = Extract<keyof Protocol[Direction], string>;

export type ProtocolSendArgs<
    Protocol extends SonicProtocolTypes,
    Direction extends keyof SonicProtocolTypes,
    Tag extends ProtocolPacketTags<Protocol, Direction>,
> = Protocol[Direction][Tag] extends { readonly sendArgs: infer Args extends readonly any[] }
    ? Args
    : any[];

export type ProtocolListenerArgs<
    Protocol extends SonicProtocolTypes,
    Direction extends keyof SonicProtocolTypes,
    Tag extends ProtocolPacketTags<Protocol, Direction>,
> = Protocol[Direction][Tag] extends { readonly listenerArgs: infer Args extends readonly any[] }
    ? Args
    : any[];

/**
 * Preserves literal packet tags and schemas when a packet list is stored in a
 * variable before being passed to a server or client.
 */
export function DefinePackets<const T extends readonly AnyPacket[]>(packets: T): Readonly<T> {
    return packets;
}

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
type InferredSingleSettings<
    Tag extends string,
    T extends ArguableType,
    Fields extends readonly string[] | undefined,
    AutoFlatten extends boolean | undefined,
    DontSpread extends boolean | undefined,
> = {
    tag: Tag;
    type: T;
    schema: Fields;
    autoFlatten: AutoFlatten;
    dontSpread: DontSpread;
    _group?: GroupMetadata;
};

type PacketOverloadSettings<
    Tag extends string,
    T extends ArguableType,
    Fields extends readonly string[] | undefined,
    AutoFlatten extends boolean | undefined,
    DontSpread extends boolean | undefined,
> = Omit<SinglePacketSettings, "tag" | "type" | "schema" | "autoFlatten" | "dontSpread"> & {
    tag: Tag;
    type: T;
    schema?: Fields;
    autoFlatten?: AutoFlatten;
    dontSpread?: DontSpread;
    _group?: GroupMetadata;
};

type PacketOverload<
    Tag extends string,
    T extends ArguableType,
    Fields extends readonly string[] | undefined,
    AutoFlatten extends boolean | undefined,
    DontSpread extends boolean | undefined,
> = TypedSinglePacket<InferredSingleSettings<Tag, T, Fields, AutoFlatten, DontSpread>>;

export function CreatePacket<const Tag extends string, const Fields extends readonly string[] | undefined = undefined, const AutoFlatten extends boolean | undefined = undefined, const DontSpread extends boolean | undefined = undefined>(settings: PacketOverloadSettings<Tag, PacketType.NONE, Fields, AutoFlatten, DontSpread>): PacketOverload<Tag, PacketType.NONE, Fields, AutoFlatten, DontSpread>;
export function CreatePacket<const Tag extends string, const Fields extends readonly string[] | undefined = undefined, const AutoFlatten extends boolean | undefined = undefined, const DontSpread extends boolean | undefined = undefined>(settings: PacketOverloadSettings<Tag, PacketType.RAW, Fields, AutoFlatten, DontSpread>): PacketOverload<Tag, PacketType.RAW, Fields, AutoFlatten, DontSpread>;
export function CreatePacket<const Tag extends string, const Fields extends readonly string[] | undefined = undefined, const AutoFlatten extends boolean | undefined = undefined, const DontSpread extends boolean | undefined = undefined>(settings: PacketOverloadSettings<Tag, PacketType.STRINGS_ASCII, Fields, AutoFlatten, DontSpread>): PacketOverload<Tag, PacketType.STRINGS_ASCII, Fields, AutoFlatten, DontSpread>;
export function CreatePacket<const Tag extends string, const Fields extends readonly string[] | undefined = undefined, const AutoFlatten extends boolean | undefined = undefined, const DontSpread extends boolean | undefined = undefined>(settings: PacketOverloadSettings<Tag, PacketType.STRINGS_UTF16, Fields, AutoFlatten, DontSpread>): PacketOverload<Tag, PacketType.STRINGS_UTF16, Fields, AutoFlatten, DontSpread>;
export function CreatePacket<const Tag extends string, const Fields extends readonly string[] | undefined = undefined, const AutoFlatten extends boolean | undefined = undefined, const DontSpread extends boolean | undefined = undefined>(settings: PacketOverloadSettings<Tag, PacketType.ENUMS, Fields, AutoFlatten, DontSpread>): PacketOverload<Tag, PacketType.ENUMS, Fields, AutoFlatten, DontSpread>;
export function CreatePacket<const Tag extends string, const Fields extends readonly string[] | undefined = undefined, const AutoFlatten extends boolean | undefined = undefined, const DontSpread extends boolean | undefined = undefined>(settings: PacketOverloadSettings<Tag, PacketType.BYTES, Fields, AutoFlatten, DontSpread>): PacketOverload<Tag, PacketType.BYTES, Fields, AutoFlatten, DontSpread>;
export function CreatePacket<const Tag extends string, const Fields extends readonly string[] | undefined = undefined, const AutoFlatten extends boolean | undefined = undefined, const DontSpread extends boolean | undefined = undefined>(settings: PacketOverloadSettings<Tag, PacketType.UBYTES, Fields, AutoFlatten, DontSpread>): PacketOverload<Tag, PacketType.UBYTES, Fields, AutoFlatten, DontSpread>;
export function CreatePacket<const Tag extends string, const Fields extends readonly string[] | undefined = undefined, const AutoFlatten extends boolean | undefined = undefined, const DontSpread extends boolean | undefined = undefined>(settings: PacketOverloadSettings<Tag, PacketType.SHORTS, Fields, AutoFlatten, DontSpread>): PacketOverload<Tag, PacketType.SHORTS, Fields, AutoFlatten, DontSpread>;
export function CreatePacket<const Tag extends string, const Fields extends readonly string[] | undefined = undefined, const AutoFlatten extends boolean | undefined = undefined, const DontSpread extends boolean | undefined = undefined>(settings: PacketOverloadSettings<Tag, PacketType.USHORTS, Fields, AutoFlatten, DontSpread>): PacketOverload<Tag, PacketType.USHORTS, Fields, AutoFlatten, DontSpread>;
export function CreatePacket<const Tag extends string, const Fields extends readonly string[] | undefined = undefined, const AutoFlatten extends boolean | undefined = undefined, const DontSpread extends boolean | undefined = undefined>(settings: PacketOverloadSettings<Tag, PacketType.VARINT, Fields, AutoFlatten, DontSpread>): PacketOverload<Tag, PacketType.VARINT, Fields, AutoFlatten, DontSpread>;
export function CreatePacket<const Tag extends string, const Fields extends readonly string[] | undefined = undefined, const AutoFlatten extends boolean | undefined = undefined, const DontSpread extends boolean | undefined = undefined>(settings: PacketOverloadSettings<Tag, PacketType.UVARINT, Fields, AutoFlatten, DontSpread>): PacketOverload<Tag, PacketType.UVARINT, Fields, AutoFlatten, DontSpread>;
export function CreatePacket<const Tag extends string, const Fields extends readonly string[] | undefined = undefined, const AutoFlatten extends boolean | undefined = undefined, const DontSpread extends boolean | undefined = undefined>(settings: PacketOverloadSettings<Tag, PacketType.DELTAS, Fields, AutoFlatten, DontSpread>): PacketOverload<Tag, PacketType.DELTAS, Fields, AutoFlatten, DontSpread>;
export function CreatePacket<const Tag extends string, const Fields extends readonly string[] | undefined = undefined, const AutoFlatten extends boolean | undefined = undefined, const DontSpread extends boolean | undefined = undefined>(settings: PacketOverloadSettings<Tag, PacketType.FLOATS, Fields, AutoFlatten, DontSpread>): PacketOverload<Tag, PacketType.FLOATS, Fields, AutoFlatten, DontSpread>;
export function CreatePacket<const Tag extends string, const Fields extends readonly string[] | undefined = undefined, const AutoFlatten extends boolean | undefined = undefined, const DontSpread extends boolean | undefined = undefined>(settings: PacketOverloadSettings<Tag, PacketType.DOUBLES, Fields, AutoFlatten, DontSpread>): PacketOverload<Tag, PacketType.DOUBLES, Fields, AutoFlatten, DontSpread>;
export function CreatePacket<const Tag extends string, const Fields extends readonly string[] | undefined = undefined, const AutoFlatten extends boolean | undefined = undefined, const DontSpread extends boolean | undefined = undefined>(settings: PacketOverloadSettings<Tag, PacketType.BOOLEANS, Fields, AutoFlatten, DontSpread>): PacketOverload<Tag, PacketType.BOOLEANS, Fields, AutoFlatten, DontSpread>;
export function CreatePacket<const Tag extends string, const Fields extends readonly string[] | undefined = undefined, const AutoFlatten extends boolean | undefined = undefined, const DontSpread extends boolean | undefined = undefined>(settings: PacketOverloadSettings<Tag, PacketType.JSON, Fields, AutoFlatten, DontSpread>): PacketOverload<Tag, PacketType.JSON, Fields, AutoFlatten, DontSpread>;
export function CreatePacket<const Tag extends string, const Fields extends readonly string[] | undefined = undefined, const AutoFlatten extends boolean | undefined = undefined, const DontSpread extends boolean | undefined = undefined>(settings: PacketOverloadSettings<Tag, PacketType.HEX, Fields, AutoFlatten, DontSpread>): PacketOverload<Tag, PacketType.HEX, Fields, AutoFlatten, DontSpread>;

export function CreatePacket<
    const Tag extends string,
    const T extends ArguableType,
    const Fields extends readonly string[] | undefined = undefined,
    const AutoFlatten extends boolean | undefined = undefined,
    const DontSpread extends boolean | undefined = undefined,
>(
    settings: Omit<SinglePacketSettings, "tag" | "type" | "schema" | "autoFlatten" | "dontSpread"> & {
        tag: Tag;
        type: T;
        schema?: Fields;
        autoFlatten?: AutoFlatten;
        dontSpread?: DontSpread;
        _group?: GroupMetadata;
    },
): TypedSinglePacket<InferredSingleSettings<Tag, T, Fields, AutoFlatten, DontSpread>>;
export function CreatePacket<
    const Tag extends string,
    const Fields extends readonly string[] | undefined = undefined,
    const AutoFlatten extends boolean | undefined = undefined,
    const DontSpread extends boolean | undefined = undefined,
>(
    settings: Omit<SinglePacketSettings, "tag" | "type" | "schema" | "autoFlatten" | "dontSpread"> & {
        tag: Tag;
        type?: undefined;
        schema?: Fields;
        autoFlatten?: AutoFlatten;
        dontSpread?: DontSpread;
        _group?: GroupMetadata;
    },
): TypedSinglePacket<InferredSingleSettings<Tag, PacketType.NONE, Fields, AutoFlatten, DontSpread>>;
export function CreatePacket(
    settings: SinglePacketSettings & { _group?: GroupMetadata },
): AnyPacket {
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

    return new Packet(tag, schema, validator, enabled, false) as AnyPacket;
}

/**
 * Creates a structure for an object (multi-typed) packet.
 * This packet allows multiple types and their associated data caps.
 * @param settings Field types, limits, transposition, validation, and batching settings.
 * @returns The constructed packet structure data.
 * @throws {Error} If any type in `types` is invalid.
 */
export function CreateObjPacket<
    const S extends MultiPacketSettings,
    T extends readonly ArguableType[] = S["types"],
    V extends readonly PacketType[] = { [K in keyof T]: ConvertType<T[K]> },
>(
    settings: S & { readonly types: T },
): TypedObjPacket<S & { readonly types: T }> {
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

    return new Packet<V>(tag, schema, validator, enabled, false) as TypedObjPacket<S & { readonly types: T }>;
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
export function CreatePacketGroup<const S extends PacketGroupSettings>(settings: S): Packet<any>[] {
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

        return (CreatePacket as (settings: SinglePacketSettings & { _group: GroupMetadata }) => AnyPacket)({
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
