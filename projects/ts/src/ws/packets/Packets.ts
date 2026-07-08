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

// packet metadata stays JSON for forward-compatible schema extensions

import { DefineEnum } from "../util/enums/EnumHandler";
import { EnumPackage, TYPE_CONVERSION_MAP } from "../util/enums/EnumType";
import { SonicWSConnection } from "../server/SonicWSConnection";
import { compressBools, convertVarInt, decompressBools, readVarInt } from "../util/packets/CompressionUtil";
import { ArguableType, UnFlattenData } from "../util/packets/PacketUtils";
import { PacketType } from "./PacketType";
import { processCharCodes, as8String } from "../util/StringUtil";
import {
    decodeNative,
    decodeNativeObject,
    deflateNative,
    encodeNative,
    encodeNativeObject,
    inflateNative,
    validateNative,
    validateNativeObject,
} from "../../native/wrapper";
import { compressJSON, decompressJSON } from "../util/JSONUtil";
import { resolvePacketConstructor } from "../util/packets/metadata/ConstructorRegistry";

export type ValidatorFunction<Packet = unknown> = ((socket: SonicWSConnection<any, any>, ...values: any) => boolean) | null;

export type ConvertType<T> = T extends EnumPackage ? PacketType.ENUMS : T;
type ImpactType<T extends (PacketType | readonly PacketType[]), K> = T extends readonly PacketType[] ? K[] : K;

export class Packet<
    T extends (PacketType | readonly PacketType[]),
    PS extends PacketSchema<T> = PacketSchema<T>,
> {
    public defaultEnabled: boolean;

    public readonly tag: string;

    public readonly maxSize: number;
    public readonly minSize: number;

    public readonly type: ImpactType<T, PacketType>;
    public readonly enumData: EnumPackage[];

    public dataMax: ImpactType<T, number>;
    public dataMin: ImpactType<T, number>;

    public readonly dataBatching: number;
    public readonly maxBatchSize: number;

    public readonly dontSpread: boolean;
    public readonly autoFlatten: boolean;
    public readonly fields?: readonly string[];
    public readonly quantized?: { scale: number; trackError?: boolean };
    public readonly valueMin?: number;
    public readonly valueMax?: number;
    public readonly parent?: string;
    public readonly variant?: string;
    public readonly isParent: boolean;
    public readonly permutationValues?: readonly string[];
    public readonly constructorName?: string;
    public readonly replay: boolean;

    public readonly rateLimit: number;

    public readonly async: boolean;
    public readonly rereference: boolean;
    public readonly gzipCompression: boolean;

    public readonly object: boolean;
    public readonly client: boolean;
    
    public processReceive: (data: Uint8Array, validationResult: any) => any;
    public processSend: (data: any[]) => Uint8Array | Promise<Uint8Array>;
    public validate: (data: Uint8Array) => Promise<[Uint8Array, boolean]>;
    public customValidator: ValidatorFunction<this>;
    lastReceived: Record<number, any> = {};
    lastSent: Record<number, number | bigint> = {};
    private quantizationErrors: Record<number, number> = {};
    private readonly recordValues?: (record: Record<string, any>) => any[];

    constructor(tag: string, schema: PS, customValidator: ValidatorFunction<PS>, enabled: boolean, client: boolean) {
        this.tag = tag;
        this.defaultEnabled = enabled;
        this.client = client;
        
        this.async           = schema.async;
        this.enumData        = schema.enumData;
        this.rateLimit       = schema.rateLimit;
        this.dontSpread      = schema.dontSpread;
        this.autoFlatten     = schema.autoFlatten;
        this.rereference     = schema.rereference;
        this.dataBatching    = schema.dataBatching;
        this.maxBatchSize    = client ? Infinity : schema.maxBatchSize;
        this.gzipCompression = schema.gzipCompression;
        this.fields = schema.fields;
        this.recordValues = this.fields ? Packet.compileRecordValues(this.fields) : undefined;
        this.quantized = schema.quantized ? { ...schema.quantized, trackError: schema.quantized.trackError ?? true } : undefined;
        this.valueMin = schema.valueMin;
        this.valueMax = schema.valueMax;
        this.parent = schema.group?.parent;
        this.variant = schema.group?.variant;
        this.isParent = schema.group?.isParent ?? false;
        this.permutationValues = schema.group?.permutation;
        this.constructorName = schema.constructorName;
        this.replay = schema.replay;

        this.object = schema.object;

        this.type    = schema.type;
        this.dataMax = schema.dataMax;
        this.dataMin = schema.dataMin;

        if(schema.testObject(this)) {
            this.maxSize = this.minSize = this.type.length;
            
            for(let i=0;i<this.type.length;i++)
                if(this.type[i] == PacketType.NONE) 
                    this.dataMax[i] = this.dataMin[i] = 0;

            const nativeSchema = {
                types: this.type,
                dataMins: this.dataMin,
                dataMaxes: this.dataMax,
                enumData: this.enumData,
            };
            this.processReceive = data => decodeNativeObject(nativeSchema, data).map((field, index) =>
                this.type[index] === PacketType.JSON ? decompressJSON(field as Uint8Array) : field);
            this.processSend = data => {
                let enumIndex = 0;
                const nativeData = data.map((field, index) => {
                    if (this.type[index] === PacketType.JSON) return compressJSON(field);
                    if (this.type[index] !== PacketType.ENUMS) return field;
                    const pkg = this.enumData[enumIndex++];
                    const indices = Array.isArray(field) ? field : [field];
                    return indices.map(value => {
                        if (!Number.isInteger(value) || value < 0 || value >= pkg.values.length)
                            throw new Error(`Invalid wrapped enum index: ${value}`);
                        return pkg.values[value];
                    });
                });
                return encodeNativeObject(nativeSchema, nativeData);
            };
            this.validate = async data => {
                validateNativeObject(nativeSchema, data);
                const fields = decodeNativeObject(nativeSchema, data);
                fields.forEach((field, index) => {
                    if (this.type[index] !== PacketType.JSON) return;
                    const decoded = decompressJSON(field as Uint8Array);
                    const count = Array.isArray(decoded) ? decoded.length : 1;
                    if (count < this.dataMin[index] || count > this.dataMax[index])
                        throw new Error("JSON value count is outside schema limits");
                });
                return [data, true];
            };
        } else if (((_: any): _ is Packet<PacketType, PacketSchema<PacketType>> => true)(this)) {
            this.maxSize = this.dataMax;
            this.minSize = this.dataMin;

            if(this.type == PacketType.NONE) (this.dataMax as any) = (this.dataMin as any) = 0;

            const enumData = this.enumData[0];
            this.processReceive = data => this.type === PacketType.JSON
                ? decompressJSON(data)
                : decodeNative(this.type, data, this.dataMax, enumData);
            this.processSend = data => {
                let encoded: Uint8Array;
                if (this.type === PacketType.JSON) encoded = compressJSON(data);
                else if (this.type === PacketType.ENUMS) encoded = Uint8Array.from(data);
                else {
                    const input = this.type === PacketType.RAW && data.length === 1 && data[0] instanceof Uint8Array
                        ? data[0] : data;
                    encoded = encodeNative(this.type, input, enumData);
                }
                return this.gzipCompression && this.dataBatching === 0 ? deflateNative(encoded) : encoded;
            };
            this.validate = async data => {
                const decoded = this.gzipCompression && this.dataBatching === 0 ? inflateNative(data) : data;
                if (this.type === PacketType.JSON) {
                    const value = decompressJSON(decoded);
                    const count = Array.isArray(value) ? value.length : 1;
                    if (count < this.dataMin || count > this.dataMax)
                        throw new Error("JSON value count is outside schema limits");
                }
                else validateNative(this.type, decoded, this.dataMin, this.dataMax, { enumData });
                return [decoded, true];
            };
        } else {
            throw new Error(`Packet "${tag}" has an unsupported schema shape`);
        }

        this.customValidator = customValidator;
    }

    private static compileRecordValues(fields: readonly string[]): (record: Record<string, any>) => any[] {
        // fixed-width schemas are common enough that avoiding callback machinery is measurable
        // bracket access keeps this CSP-safe without eval or new Function
        switch (fields.length) {
            case 0:
                return () => [];
            case 1: {
                const [a] = fields;
                return record => [record[a]];
            }
            case 2: {
                const [a, b] = fields;
                return record => [record[a], record[b]];
            }
            case 3: {
                const [a, b, c] = fields;
                return record => [record[a], record[b], record[c]];
            }
            case 4: {
                const [a, b, c, d] = fields;
                return record => [record[a], record[b], record[c], record[d]];
            }
            case 5: {
                const [a, b, c, d, e] = fields;
                return record => [record[a], record[b], record[c], record[d], record[e]];
            }
            case 6: {
                const [a, b, c, d, e, f] = fields;
                return record => [record[a], record[b], record[c], record[d], record[e], record[f]];
            }
            case 7: {
                const [a, b, c, d, e, f, g] = fields;
                return record => [record[a], record[b], record[c], record[d], record[e], record[f], record[g]];
            }
            case 8: {
                const [a, b, c, d, e, f, g, h] = fields;
                return record => [
                    record[a], record[b], record[c], record[d],
                    record[e], record[f], record[g], record[h],
                ];
            }
            default:
                return record => {
                    const output = new Array(fields.length);
                    for (let index = 0; index < fields.length; index++) {
                        output[index] = record[fields[index]];
                    }
                    return output;
                };
        }
    }

    private assertRecord(record: any, context: string): any[] {
        if (!this.fields) throw new Error(`Packet "${this.tag}" ${context} requires schema`);
        if (record === null || typeof record !== "object" || Array.isArray(record))
            throw new Error(`Packet "${this.tag}" ${context} requires an object record`);
        for (const field of this.fields) {
            if (!Object.prototype.hasOwnProperty.call(record, field))
                throw new Error(`Packet "${this.tag}" is missing schema field(s): ${field}`);
        }
        const keys = Object.keys(record);
        if (keys.length !== this.fields.length) {
            const extra = keys.filter(field => !this.fields!.includes(field));
            if (extra.length) throw new Error(`Packet "${this.tag}" has unknown schema field(s): ${extra.join(", ")}`);
        }
        return this.recordValues!(record);
    }

    private construct(values: Record<string, any>): any {
        return this.constructorName ? new (resolvePacketConstructor(this.constructorName))(values) : values;
    }

    private logicalValue(value: any, direction: "send" | "receive", stateKey: number): number {
        const scale = this.quantized?.scale;
        if (typeof value !== "number" || !Number.isFinite(value))
            throw new Error(`Packet "${this.tag}" ${direction} value must be a finite number`);
        const logical = direction === "receive" && scale ? value / scale : value;
        if (this.valueMin !== undefined && logical < this.valueMin)
            throw new Error(`Packet "${this.tag}" value ${logical} is below minimum ${this.valueMin}`);
        if (this.valueMax !== undefined && logical > this.valueMax)
            throw new Error(`Packet "${this.tag}" value ${logical} exceeds maximum ${this.valueMax}`);
        if (direction === "send" && scale) {
            const adjusted = logical * scale + (this.quantized?.trackError ? (this.quantizationErrors[stateKey] ?? 0) : 0);
            const wire = Math.round(adjusted);
            if (this.quantized?.trackError) this.quantizationErrors[stateKey] = adjusted - wire;
            return wire;
        }
        return logical;
    }

    private logical(values: any[], direction: "send" | "receive", stateKey: number = -1): any[] {
        const output = new Array(values.length);
        for (let index = 0; index < values.length; index++) {
            output[index] = this.logicalValue(values[index], direction, stateKey);
        }
        return output;
    }

    /** Converts ergonomic application values into the existing positional wire model. */
    public prepareSend(values: any[], stateKey: number = -1): any[] {
        if (this.object) {
            if (this.autoFlatten && this.fields) {
                if (values.length !== 1 || !Array.isArray(values[0]))
                    throw new Error(`Packet "${this.tag}" autoTranspose requires one array of records`);
                const rows = values[0].map((row: any) => this.assertRecord(row, "autoTranspose"));
                return this.fields.map((_, column) => rows.map((row: any[]) => row[column]));
            }
            return values;
        }

        let flat = values;
        if (this.autoFlatten) {
            if (values.length !== 1 || !Array.isArray(values[0]))
                throw new Error(`Packet "${this.tag}" autoFlatten requires one array of records`);
            const rows = values[0];
            const width = this.fields!.length;
            flat = new Array(rows.length * width);
            let offset = 0;
            const transform = this.quantized || this.valueMin !== undefined || this.valueMax !== undefined;
            for (const row of rows) {
                const mapped = this.assertRecord(row, "autoFlatten");
                for (let column = 0; column < width; column++) {
                    const value = mapped[column];
                    flat[offset++] = transform ? this.logicalValue(value, "send", stateKey) : value;
                }
            }
            if (this.fields && flat.length % this.fields.length !== 0)
                throw new Error(`Packet "${this.tag}" flat value count must be divisible by schema length ${this.fields.length}`);
            if (transform) return flat;
        } else if (this.fields && values.length === 1 && values[0] !== null && typeof values[0] === "object" && !Array.isArray(values[0])) {
            flat = this.assertRecord(values[0], "schema mapping");
        }
        return this.quantized || this.valueMin !== undefined || this.valueMax !== undefined ? this.logical(flat, "send", stateKey) : flat;
    }

    /** Clears error-feedback state for a disconnected sender. */
    public clearQuantizationState(stateKey: number): void {
        delete this.quantizationErrors[stateKey];
    }

    /** Expands this group variant into its negotiated boolean permutation. */
    public permutation(): Record<string, boolean> | undefined {
        if (!this.permutationValues) return undefined;
        const enabled = new Set(this.variant ? this.variant.split(",") : []);
        return Object.fromEntries(this.permutationValues.map(value => [value, enabled.has(value)]));
    }

    /** Converts decoded positional data into schema objects and application-level numbers. */
    public finishReceive(decoded: any): any {
        if (this.object) {
            if (this.autoFlatten && this.fields) {
                const columns = decoded as any[][];
                const count = columns[0]?.length ?? 0;
                if (columns.some(column => column.length !== count))
                    throw new Error(`Packet "${this.tag}" autoTranspose columns have different lengths`);
                return Array.from({ length: count }, (_, row) => {
                    const entries = this.fields!.map((field, column) => [field, columns[column][row]]);
                    return this.construct(Object.fromEntries(entries));
                });
            }
            return this.autoFlatten ? UnFlattenData(decoded) : decoded;
        }

        let values = Array.isArray(decoded) ? decoded : [decoded];
        if (this.quantized || this.valueMin !== undefined || this.valueMax !== undefined) {
            values = this.logical(values, "receive");
        }

        if (this.autoFlatten) {
            const width = this.fields!.length;
            if (values.length % width !== 0) {
                throw new Error(`Packet "${this.tag}" flat value count ${values.length} is not divisible by schema length ${width}`);
            }

            return Array.from({ length: values.length / width }, (_, row) =>
                this.construct(Object.fromEntries(this.fields!.map((field, col) => [field, values[row * width + col]]))));
        }

        if (this.fields) {
            const entries = this.fields.map((field, index) => [field, values[index]]);
            return this.construct(Object.fromEntries(entries));
        }

        return decoded;
    }

    public async listen(value: Uint8Array, socket: SonicWSConnection<any, any> | null): Promise<[processed: any, flatten: boolean] | string> {
        try {
            const [dcData, validationResult] = await this.validate(value);
            // strict comparison matters because validation metadata may be non-boolean
            if (!this.client && validationResult === false) return "Invalid packet";

            const processed = this.processReceive(dcData, validationResult);
            
            const usableData = this.finishReceive(processed);

            if (this.customValidator != null) {
                if (!this.dontSpread && !this.fields) {
                    if (!this.customValidator(socket!, ...usableData)) return "Didn't pass custom validator";
                } else {
                    if (!this.customValidator(socket!, usableData)) return "Didn't pass custom validator";
                }
            }

            const permutation = this.permutation();
            const delivered = this.isParent
                ? { variant: "", payload: usableData, ...(permutation && { permutation }) }
                : usableData;
            return [delivered, this.isParent || this.fields ? false : !this.dontSpread];
        } catch (error) {
            console.error(
                "SonicWS failed to process a packet. Report reproducible codec failures at https://github.com/liwybloc/sonic-ws",
                error,
            );
            return `Error: ${String(error)}`;
        }
    }

    /** Serializes this packet definition for schema negotiation. */
    public serialize(): number[] {
        const metadata = new TextEncoder().encode(JSON.stringify({
            schema: this.fields,
            quantized: this.quantized,
            min: this.valueMin,
            max: this.valueMax,
            group: this.parent !== undefined ? {
                parent: this.parent,
                variant: this.variant ?? "",
                isParent: this.isParent,
                permutation: this.permutationValues,
            } : undefined,
            constructor: this.constructorName,
            replay: this.replay || undefined,
        }));

        // shared fields precede the shape-specific range and type data
        const sharedData: number[] = [
            this.tag.length,
            ...processCharCodes(this.tag),
            compressBools([this.dontSpread, this.async, this.object, this.autoFlatten, this.gzipCompression, this.rereference]),
            ...convertVarInt(metadata.length),
            ...metadata,
            this.dataBatching,
            this.enumData.length,
            ...this.enumData.flatMap(enumPackage => enumPackage.serialize()),
        ];

        if (!this.object) {
            return [
                ...sharedData,
                ...convertVarInt(this.dataMax as number),
                ...convertVarInt(this.dataMin as number),
                this.type as PacketType,
            ];
        }

        return [
            ...sharedData,
            this.maxSize,
            ...(this.dataMax as number[]).flatMap(convertVarInt),
            ...(this.dataMin as number[]).flatMap(convertVarInt),
            ...(this.type as PacketType[]),
        ];
    }

    private static readVarInts(data: Uint8Array, offset: number, size: number): [res: number[], offset: number] {
        const values: number[] = [];

        for (let index = 0; index < size; index++) {
            const [nextOffset, value] = readVarInt(data, offset);
            offset = nextOffset;
            values.push(value);
        }

        return [values, offset];
    }

    public static deserialize(data: Uint8Array, offset: number, client: boolean): [packet: Packet<any, any>, offset: number] {
        const beginningOffset = offset;

        const tagLength = data[offset++];
        const tag = as8String(data.slice(offset, offset += tagLength));

        const [dontSpread, async, isObject, autoFlatten, gzipCompression, rereference] = decompressBools(data[offset++]);

        const [metadataOffset, metadataLength] = readVarInt(data, offset);
        offset = metadataOffset;

        const metadataBytes = data.slice(offset, offset += metadataLength);
        const metadata = JSON.parse(new TextDecoder().decode(metadataBytes)) as {
            schema?: string[];
            quantized?: { scale: number; trackError?: boolean };
            min?: number;
            max?: number;
            group?: { parent: string; variant: string; isParent: boolean; permutation?: string[] };
            constructor?: string;
            replay?: boolean;
        };

        const fields = Array.isArray(metadata.schema) ? metadata.schema : undefined;
        const quantized = metadata.quantized && typeof metadata.quantized.scale === "number"
            ? metadata.quantized
            : undefined;
        const valueMin = typeof metadata.min === "number" ? metadata.min : undefined;
        const valueMax = typeof metadata.max === "number" ? metadata.max : undefined;
        const group = metadata.group && typeof metadata.group.parent === "string" ? metadata.group : undefined;
        const constructorName = typeof metadata.constructor === "string" ? metadata.constructor : undefined;

        const dataBatching = data[offset++];
        const enumLength = data[offset++];
        const enums: EnumPackage[] = [];

        for (let enumIndex = 0; enumIndex < enumLength; enumIndex++) {
            const enumTagLength = data[offset++];
            const enumTag = as8String(data.slice(offset, offset += enumTagLength));
            const valueCount = data[offset++];
            const values = [];

            for (let valueIndex = 0; valueIndex < valueCount; valueIndex++) {
                const valueLength = data[offset++];
                const valueType = data[offset++];
                const value = as8String(data.slice(offset, offset += valueLength));
                values.push(TYPE_CONVERSION_MAP[valueType](value));
            }

            enums.push(DefineEnum(enumTag, values));
        }

        if (isObject) {
            const size = data[offset++];

            const [dataMaxes, maxOffset] = this.readVarInts(data, offset, size);
            offset = maxOffset;

            const [dataMins, minOffset] = this.readVarInts(data, offset, size);
            offset = minOffset;

            const types = Array.from(data.slice(offset, offset += size)) as PacketType[];
            let enumIndex = 0;
            const finalTypes: ArguableType[] = types.map(type =>
                type === PacketType.ENUMS ? enums[enumIndex++] : type);

            const schema = new PacketSchema<readonly PacketType[]>(
                true,
                finalTypes,
                async,
                dataMins,
                dataMaxes,
                -1,
                dontSpread,
                autoFlatten,
                false,
                dataBatching,
                -1,
                gzipCompression,
                fields,
                undefined,
                undefined,
                undefined,
                group,
                constructorName,
                metadata.replay === true,
            );

            return [
                new Packet(tag, schema, null, false, client),
                offset - beginningOffset,
            ];
        }

        const [maxOffset, dataMax] = readVarInt(data, offset);
        offset = maxOffset;

        const [minOffset, dataMin] = readVarInt(data, offset);
        offset = minOffset;

        const type = data[offset++] as PacketType;
        const finalType = type === PacketType.ENUMS ? enums[0] : type;

        const schema = new PacketSchema<PacketType>(
            false,
            finalType,
            async,
            dataMin,
            dataMax,
            -1,
            dontSpread,
            autoFlatten,
            rereference,
            dataBatching,
            -1,
            gzipCompression,
            fields,
            quantized,
            valueMin,
            valueMax,
            group,
            constructorName,
            metadata.replay === true,
        );
        
        return [
            new Packet(tag, schema, null, false, client),
            offset - beginningOffset,
        ];
    }
    
    public static deserializeAll(data: Uint8Array, client: boolean): Packet<any, any>[] {
        const packets: Packet<any, any>[] = [];

        let offset = 0;
        while (offset < data.length) {
            const [packet, length] = this.deserialize(data, offset, client);
            packets.push(packet);
            offset += length;
        }

        return packets;
    }
}

function convertType(type: ArguableType, enumData: EnumPackage[]): PacketType {
    if (!(type instanceof EnumPackage)) return type;

    enumData.push(type);
    return PacketType.ENUMS;
}

export class PacketSchema<T extends (PacketType | readonly PacketType[])> {
    public type: ImpactType<T, PacketType>;
    public enumData: EnumPackage[] = [];

    public dataMax: ImpactType<T, number>;
    public dataMin: ImpactType<T, number>;

    public dataBatching: number;
    public maxBatchSize: number;

    public rateLimit: number;

    public dontSpread: boolean = false;
    public autoFlatten: boolean = false;

    public async: boolean = false;
    public rereference: boolean = false;
    public gzipCompression: boolean = false;

    public object: boolean;
    public fields?: readonly string[];
    public quantized?: { scale: number; trackError?: boolean };
    public valueMin?: number;
    public valueMax?: number;
    public group?: { parent: string; variant: string; isParent: boolean; permutation?: string[] };
    public constructorName?: string;
    public replay: boolean;

    constructor(
        object: boolean,
        type: ImpactType<T, ArguableType>,
        async: boolean,
        dataMin: ImpactType<T, number>,
        dataMax: ImpactType<T, number>,
        rateLimit: number,
        dontSpread: boolean,
        autoFlatten: boolean,
        rereference: boolean,
        dataBatching: number,
        maxBatchSize: number,
        gzipCompression: boolean,
        fields?: readonly string[],
        quantized?: { scale: number; trackError?: boolean },
        valueMin?: number,
        valueMax?: number,
        group?: { parent: string; variant: string; isParent: boolean; permutation?: string[] },
        constructorName?: string,
        replay: boolean = false,
    ) {
        this.object = object;
        this.async = async;
        this.dataMin = dataMin;
        this.dataMax = dataMax;
        this.rateLimit = rateLimit;
        this.dontSpread = dontSpread;
        this.autoFlatten = autoFlatten;
        this.rereference = rereference;
        this.dataBatching = dataBatching;
        this.maxBatchSize = maxBatchSize;
        this.gzipCompression = gzipCompression;
        this.fields = fields ? [...fields] : undefined;
        this.quantized = quantized ? { ...quantized } : undefined;
        this.valueMin = valueMin;
        this.valueMax = valueMax;
        this.group = group ? { ...group } : undefined;
        this.constructorName = constructorName;
        this.replay = replay;

        this.type = (
            object
                ? (type as ArguableType[]).map(value => convertType(value, this.enumData))
                : convertType(type as ArguableType, this.enumData)
        ) as ImpactType<T, PacketType>;
    }

    testObject<PST extends PacketSchema<T>>(packet: Packet<PacketType | readonly PacketType[], PST>): packet is Packet<PacketType[], PacketSchema<PacketType[]>> {
        return this.object;
    }
}
