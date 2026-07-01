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

import { DefineEnum } from "../util/enums/EnumHandler";
import { EnumPackage, TYPE_CONVERSION_MAP } from "../util/enums/EnumType";
import { SonicWSConnection } from "../server/SonicWSConnection";
import { compressBools, convertVarInt, decompressBools, readVarInt } from "../util/packets/CompressionUtil";
import { ArguableType, UnFlattenData } from "../util/packets/PacketUtils";
import { createObjReceiveProcessor, createObjSendProcessor, createObjValidator, createReceiveProcessor, createSendProcessor, createValidator, PacketReceiveProcessor, PacketSendProcessor, PacketTypeValidator } from "./PacketProcessors";
import { PacketType } from "./PacketType";
import { processCharCodes, as8String } from "../util/StringUtil";

export type ValidatorFunction = ((socket: SonicWSConnection, values: any) => boolean) | null;

export type ConvertType<T> = T extends EnumPackage ? PacketType.ENUMS : T;
type ImpactType<T extends (PacketType | readonly PacketType[]), K> = T extends readonly PacketType[] ? K[] : K;

export class Packet<T extends (PacketType | readonly PacketType[])> {
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

    public readonly rateLimit: number;

    public readonly async: boolean;
    public readonly rereference: boolean;
    public readonly gzipCompression: boolean;

    public readonly object: boolean;
    public readonly client: boolean;
    
    private receiveProcessor: PacketReceiveProcessor;
    private sendProcessor: PacketSendProcessor;
    private validator: PacketTypeValidator;

    public processReceive: (data: Uint8Array, validationResult: any) => any;
    public processSend: (data: any[]) => Promise<Uint8Array>;
    public validate: (data: Uint8Array) => Promise<[Uint8Array, boolean]>;
    public customValidator: ((socket: SonicWSConnection, ...values: any[]) => boolean) | null;
    lastReceived: Record<number, any> = {};
    lastSent: Record<number, number | bigint> = {};

    constructor(tag: string, schema: PacketSchema<T>, customValidator: ValidatorFunction, enabled: boolean, client: boolean) {
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

        this.object = schema.object;

        this.type    = schema.type;
        this.dataMax = schema.dataMax;
        this.dataMin = schema.dataMin;

        if(schema.testObject(this)) {
            this.maxSize = this.minSize = this.type.length;
            
            for(let i=0;i<this.type.length;i++)
                if(this.type[i] == PacketType.NONE) 
                    this.dataMax[i] = this.dataMin[i] = 0;

            this.receiveProcessor = createObjReceiveProcessor(this);
            this.sendProcessor    = createObjSendProcessor(this);
            this.validator        = createObjValidator(this);
        } else if (((_: any): _ is Packet<PacketType> => true)(this)) {
            this.maxSize = this.dataMax;
            this.minSize = this.dataMin;

            if(this.type == PacketType.NONE) (this.dataMax as any) = (this.dataMin as any) = 0;

            this.receiveProcessor = createReceiveProcessor(this.type, this.enumData, this.dataMax);
            this.sendProcessor    = createSendProcessor(this.type, this.gzipCompression, this.dataBatching != 0);
            this.validator        = createValidator(this.type, this.dataMax, this.dataMin, this, this.gzipCompression);
        } else throw'';
        
        this.processReceive  = (data: Uint8Array, validationResult: any) => this.receiveProcessor(data, validationResult, 0);
        this.processSend     = async (data: any[]) => new Uint8Array(await this.sendProcessor(tag, data));
        this.validate        = (data: Uint8Array) => this.validator(data, 0);
        this.customValidator = customValidator;
    }

    public async listen(value: Uint8Array, socket: SonicWSConnection | null): Promise<[processed: any, flatten: boolean] | string> {
        try {
            const [dcData, validationResult] = await this.validate(value);
            // holy shit i used === to fix another bug
            if(!this.client && validationResult === false) return "Invalid packet";

            const processed = this.processReceive(dcData, validationResult);
            
            const useableData = this.autoFlatten ? UnFlattenData(processed) : processed;

            if(this.customValidator != null) {
                if(!this.dontSpread) {
                    if(!this.customValidator(socket!, ...useableData)) return "Didn't pass custom validator";
                } else {
                    if(!this.customValidator(socket!, useableData)) return "Didn't pass custom validator";
                }
            }
            return [useableData, !this.dontSpread];
        } catch (err) {
            console.error("There was an error processing the packet! This is probably my fault... report at https://github.com/liwybloc/sonic-ws", err);
            return "Error: " + err;
        }
    }

    public serialize(): number[] {

        // shared values for both
        const sharedData: number[] = [
            this.tag.length, ...processCharCodes(this.tag),
            compressBools([this.dontSpread, this.async, this.object, this.autoFlatten, this.gzipCompression, this.rereference]),
            this.dataBatching,
            this.enumData.length, ...this.enumData.map(x => x.serialize()).flat(),
        ];

        // single-value packet (not an object schema)
        if (!this.object) {
            return [
                ...sharedData,                             // shared
                ...convertVarInt(this.dataMax as number),  // the data max
                ...convertVarInt(this.dataMin as number),  // the data min
                this.type as PacketType,                   // type
            ];
        }

        // object packet
        return [
            ...sharedData,
            this.maxSize,                                            // size
            ...(this.dataMax as number[]).map(convertVarInt).flat(), // all data maxes, serialized
            ...(this.dataMin as number[]).map(convertVarInt).flat(), // all data mins, serialized
            ...(this.type as PacketType[]),                          // all types
        ];
    }

    private static readVarInts(data: Uint8Array, offset: number, size: number): [res: number[], offset: number] {
        const res: number[] = [];
        for(let i=0;i<size;i++) {
            const [off, varint] = readVarInt(data, offset);
            offset = off;
            res.push(varint);
        }
        return [res, offset];
    }

    public static deserialize(data: Uint8Array, offset: number, client: boolean): [packet: Packet<any>, offset: number] {
        const beginningOffset = offset;

        // read length, go up 1
        const tagLength: number = data[offset++];
        // read tag as it's up 1, and add offset
        const tag: string = as8String(data.slice(offset, offset += tagLength));

        // then read dontSpread and async
        const [dontSpread, async, isObject, autoFlatten, gzipCompression, rereference] = decompressBools(data[offset++]);

        // read batching, up 1
        const dataBatching: number = data[offset++];

        // read enum length, up 1
        const enumLength = data[offset++];
        const enums: EnumPackage[] = [];

        for (let i = 0; i < enumLength; i++) {
            // read tag length, go up 1
            const enumTagLength = data[offset++];
            // up 1 so read offset -> offset += tag length, to add tag length and skip over it
            const enumTag = as8String(data.slice(offset, offset += enumTagLength));
            // read amount of values
            const valueCount = data[offset++];
            const values = [];
            for (let j = 0; j < valueCount; j++) {
                // read the length of the value, go up 1
                const valueLength = data[offset++];
                // then read the type of value, up 1
                const valueType = data[offset++];
                // now can just read the values, increase offset for later use
                const value = as8String(data.slice(offset, offset += valueLength));
                // process it
                values.push(TYPE_CONVERSION_MAP[valueType](value));
            }
            // define the enum with the values
            enums.push(DefineEnum(enumTag, values));
        }

        // objects
        if (isObject) {
            
            // read size
            const size: number = data[offset++];

            // read var ints for the datamaxes
            const [dataMaxes, o1] = this.readVarInts(data, offset, size)
            offset = o1;
            
            // read var ints for the datamins
            const [dataMins, o2] = this.readVarInts(data, offset, size);
            offset = o2;

            // get types, skip past size since there'll be size of these
            const types: PacketType[]  = Array.from(data.slice(offset, offset += size));

            // convert any enums into their indexed form for best bandwidth
            let index = 0;
            const finalTypes: ArguableType[] = types.map(x => x == PacketType.ENUMS ? enums[index++] : x); // convert enums to their enum packages

            // make schema
            const schema = new PacketSchema<readonly PacketType[]>(true, finalTypes, async, dataMins, dataMaxes, -1, dontSpread, autoFlatten, false, dataBatching, -1, gzipCompression);
            return [
                new Packet(tag, schema, null, false, client),
                // +1 to go next
                (offset - beginningOffset),
            ];
        }

        // single packet

        // read varint for datamax
        const [o1, dataMax] = readVarInt(data, offset);
        offset = o1;

        // read varint for datamin
        const [o2, dataMin] = readVarInt(data, offset);
        offset = o2;

        // read type
        const type: PacketType = data[offset++] as PacketType;

        // do enum stuff
        const finalType = type == PacketType.ENUMS ? enums[0] : type; // convert enum to enum package

    
        // make schema
        const schema = new PacketSchema<PacketType>(false, finalType, async, dataMin, dataMax, -1, dontSpread, false, rereference, dataBatching, -1, gzipCompression);
        
        return [
            new Packet(tag, schema, null, false, client),
            (offset - beginningOffset),
        ];
    }
    
    public static deserializeAll(data: Uint8Array, client: boolean): Packet<any>[] {
        const arr: Packet<any>[] = [];

        let offset = 0;
        while(offset < data.length) {
            const [packet, len] = this.deserialize(data, offset, client);
            arr.push(packet);
            offset += len;
        }

        return arr;
    }
}

const convertType = (type: ArguableType, ed: EnumPackage[]): PacketType => (type instanceof EnumPackage ? (ed.push(type), PacketType.ENUMS) : type);

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

    constructor(object: boolean, type: ImpactType<T, ArguableType>, async: boolean, dataMin: ImpactType<T, number>, dataMax: ImpactType<T, number>, rateLimit: number,
                dontSpread: boolean, autoFlatten: boolean, rereference: boolean, dataBatching: number, maxBatchSize: number, gzipCompression: boolean) {
        // todo add rereference to objects
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

        this.type = (object ? (type as ArguableType[]).map(t => convertType(t, this.enumData)) : convertType((type as ArguableType), this.enumData)) as ImpactType<T, PacketType>;
    }

    testObject(packet: Packet<PacketType | readonly PacketType[]>): packet is Packet<PacketType[]> {
        return this.object;
    }
    
}
