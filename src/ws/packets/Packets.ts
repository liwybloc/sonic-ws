/*
 * Copyright 2026 Lily (liwybloc)
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

import { DefineEnum } from "../util/enums/EnumHandler";
import { EnumPackage, TYPE_CONVERSION_MAP } from "../util/enums/EnumType";
import { SonicWSConnection } from "../server/SonicWSConnection";
import { compressBools, convertVarInt, decompressBools, readVarInt } from "../util/packets/CompressionUtil";
import { ProcessedPacket, UnFlattenData } from "../util/packets/PacketUtils";
import { createObjReceiveProcessor, createObjSendProcessor, createObjValidator, createReceiveProcessor, createSendProcessor, createValidator, PacketReceiveProcessor, PacketSendProcessor, PacketTypeValidator } from "./PacketProcessors";
import { PacketType } from "./PacketType";
import { as8String } from "../util/BufferUtil";
import { processCharCodes } from "../util/StringUtil";
import { Connection } from "../Connection";

export type ValidatorFunction = ((socket: SonicWSConnection, values: any) => boolean) | null;

export type ConvertType<T> = T extends EnumPackage ? PacketType.ENUMS : T;
type ImpactType<T extends (PacketType | readonly PacketType[]), K> = T extends PacketType[] ? K[] : K;

export class Packet<T extends (PacketType | readonly PacketType[])> {
    public defaultEnabled: boolean;

    public readonly tag: string;

    public readonly maxSize: number;
    public readonly minSize: number;

    public readonly type: T;
    public readonly enumData: EnumPackage[];

    public readonly dataMax: ImpactType<T, number>;
    public readonly dataMin: ImpactType<T, number>;

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
    lastSent: Record<number, [boolean, [((value: ProcessedPacket | PromiseLike<ProcessedPacket>) => void), any[]][], any]> = {};

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
        if(schema.testObject()) {
            this.type    = schema.type as unknown as T;
            this.dataMax = schema.dataMax;
            this.dataMin = schema.dataMin;
            // @ts-expect-error
            this.maxSize = this.type.length;
            // @ts-expect-error
            this.minSize = this.type.length;

            // trst me bro..
            this.receiveProcessor = createObjReceiveProcessor(this as any);
            this.sendProcessor    = createObjSendProcessor(this as any);
            this.validator        = createObjValidator(this as any);
        } else {
            this.type    = schema.type as unknown as T;
            this.dataMax = schema.dataMax;
            this.dataMin = schema.dataMin;
            this.maxSize = this.dataMax as number;
            this.minSize = this.dataMin as number;

            // @ts-expect-error
            this.receiveProcessor = createReceiveProcessor(this.type, this.enumData, this.dataMax);
            // @ts-expect-error
            this.sendProcessor    = createSendProcessor(this.type, this.gzipCompression, this.rereference);
            // @ts-expect-error
            this.validator        = createValidator(this.type, this.dataMax, this.dataMin, this, this.gzipCompression, this.rereference);
        }
        
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
            const finalTypes: (PacketType | EnumPackage)[] = types.map(x => x == PacketType.ENUMS ? enums[index++] : x); // convert enums to their enum packages

            // make schema
            const schema = PacketSchema.object(finalTypes, dataMaxes, dataMins, dontSpread, autoFlatten, dataBatching, -1, -1, async, gzipCompression);
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
        const schema = PacketSchema.single(finalType, dataMax, dataMin, dontSpread, dataBatching, -1, -1, async, gzipCompression, rereference);
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

export class PacketSchema<T extends (PacketType | readonly PacketType[])> {
    public type!: ImpactType<T, PacketType>;
    public dataMax!: ImpactType<T, number>;
    public dataMin!: ImpactType<T, number>;

    public dataBatching: number = 0;
    public maxBatchSize: number = 10;

    public rateLimit: number = 0;

    public enumData: EnumPackage[] = [];

    public dontSpread: boolean = false;
    public autoFlatten: boolean = false;

    public async: boolean = false;
    public rereference: boolean = false;
    public gzipCompression: boolean = false;

    public object: boolean;

    constructor(object: boolean) {
        this.object = object;
    }

    testObject(): this is PacketSchema<PacketType[]> {
        return this.object;
    }

    public static single<T extends PacketType | EnumPackage>(type: T, dataMax: number, dataMin: number, dontSpread: boolean, dataBatching: number,
                         maxBatchSize: number, rateLimit: number, async: boolean, gzipCompression: boolean, rereference: boolean): PacketSchema<ConvertType<T>> {
        const schema = new PacketSchema(false);

        if(typeof type == 'number') {
            schema.type = type as PacketType;
            if(type == PacketType.NONE) dataMax = dataMin = 0; // remove garbage data issues
        } else {
            schema.type = PacketType.ENUMS;
            schema.enumData = [type as EnumPackage];
        }

        schema.async = async;
        schema.dataMin = dataMin;
        schema.dataMax = dataMax;
        schema.rateLimit = rateLimit;
        schema.dontSpread = dontSpread;
        schema.rereference = rereference;
        schema.dataBatching = dataBatching;
        schema.maxBatchSize = maxBatchSize;
        schema.gzipCompression = gzipCompression;

        return schema;
    }

    public static object<T extends readonly (PacketType | EnumPackage)[]>(
        types: T, dataMaxes: number[], dataMins: number[], dontSpread: boolean,
        autoFlatten: boolean, dataBatching: number, maxBatchSize: number, rateLimit: number,
        async: boolean, gzipCompression: boolean
    ): PacketSchema<ConvertType<T[number]>[]> {
        if(types.length != dataMaxes.length || types.length != dataMins.length)
            throw new Error("There is an inbalance between the amount of types, data maxes, and data mins!");

        const schema = new PacketSchema<PacketType[]>(true);

        schema.type = [];
        types.forEach(type => {
            if(typeof type == 'number') {
                schema.type.push(type as PacketType);
            } else {
                schema.type.push(PacketType.ENUMS);
                schema.enumData.push(type as EnumPackage);
            }
        });

        schema.async = async;
        schema.dataMin = dataMins;
        schema.dataMax = dataMaxes;
        schema.rateLimit = rateLimit;
        schema.dontSpread = dontSpread;
        schema.autoFlatten = autoFlatten;
        schema.dataBatching = dataBatching;
        schema.maxBatchSize = maxBatchSize;
        schema.gzipCompression = gzipCompression;

        return schema;
    }
    
}
