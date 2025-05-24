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

import { DefineEnum } from "../util/enums/EnumHandler";
import { EnumPackage, TYPE_CONVERSION_MAP } from "../util/enums/EnumType";
import { SonicWSConnection } from "../server/SonicWSConnection";
import { splitArray } from "../util/ArrayUtil";
import { convertUBytePows, convertVarInt, deconvertUBytePows, deconvertVarInts, ETX, processCharCodes, readVarInt, STX } from "../util/packets/CompressionUtil";
import { UnFlattenData } from "../util/packets/PacketUtils";
import { createObjReceiveProcessor, createObjSendProcessor, createObjValidator, PacketReceiveProcessors, PacketSendProcessors, PacketValidityProcessors } from "./PacketProcessors";
import { PacketType } from "./PacketType";
import { Connection } from "../Connection";
import { asString } from "../util/BufferUtil";

export type ValidatorFunction = ((socket: SonicWSConnection, values: any[]) => boolean) | null;

export class Packet {
    public tag: string;
    public defaultEnabled: boolean;

    public maxSize: number;
    public minSize: number;

    public type: PacketType | PacketType[];
    public enumData: EnumPackage[];

    public dataMax: number | number[];
    public dataMin: number | number[];

    public packetDelimitSize: number;

    public dataBatching: number;
    public maxBatchSize: number;

    public dontSpread: boolean;
    public autoFlatten: boolean;

    public rateLimit: number;

    public object: boolean;
    
    private receiveProcessor: (data: Uint8Array, cap: any, packet: Packet, index: number) => any;
    private sendProcessor: (...data: any[]) => number[];
    private validifier: (data: Uint8Array, cap: any, min: any, packet: Packet, index: number) => boolean;

    public processReceive: (data: Uint8Array) => any;
    public processSend: (data: any[]) => number[];
    public validate: (data: Uint8Array) => boolean;
    public customValidator: ((socket: SonicWSConnection, ...values: any[]) => boolean) | null;

    constructor(tag: string, schema: PacketSchema, customValidator: ValidatorFunction, enabled: boolean, client: boolean) {
        this.tag = tag;
        this.defaultEnabled = enabled;
        
        this.enumData     = schema.enumData;
        this.rateLimit    = schema.rateLimit;
        this.dontSpread   = schema.dontSpread;
        this.autoFlatten  = schema.autoFlatten;
        this.dataBatching = schema.dataBatching;
        this.maxBatchSize = client ? Infinity : schema.maxBatchSize;

        this.packetDelimitSize = schema.packetDelimitSize;

        if(schema.object) {
            this.type    = schema.types;
            this.dataMax = schema.dataMaxes;
            this.dataMin = schema.dataMins;
            this.maxSize = this.type.length;
            this.minSize = this.type.length;
            this.object  = true;

            this.receiveProcessor = createObjReceiveProcessor(this.type, this.packetDelimitSize);
            this.validifier       = createObjValidator(this.type, this.packetDelimitSize);
            this.sendProcessor    = createObjSendProcessor(this);
        } else {
            this.type    = schema.type;
            this.dataMax = schema.dataMax;
            this.dataMin = schema.dataMin;
            this.maxSize = this.dataMax;
            this.minSize = this.dataMin;
            this.object  = false;

            this.receiveProcessor = PacketReceiveProcessors[this.type];
            this.validifier       = PacketValidityProcessors[this.type];
            this.sendProcessor    = PacketSendProcessors[this.type];
        }
        
        this.processReceive  = (data: Uint8Array) => this.receiveProcessor(data, this.dataMax, this, 0);
        this.processSend     = (data: any[]) => this.sendProcessor(data);
        this.validate        = client ? () => true : (data: Uint8Array) => this.validifier(data, this.dataMax, this.dataMin, this, 0);
        this.customValidator = customValidator;
        
        this.serializeNumber = this.serializeNumber.bind(this);
    }

    public listen(value: Uint8Array, socket: SonicWSConnection | null): [processed: any, flatten: boolean] | string {
        try {
            if(!this.validate(value)) return "Invalid packet";

            const processed = this.processReceive(value);

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
            console.error("There was an error processing the packet! This is probably my fault... report at https://github.com/cutelittlelily/sonic-ws", err);
            return "Error: " + err;
        }
    }

    private serializeNumber(n: number): number[] {
        return convertVarInt(n, false);
    }

    public serialize(): number[] {

        // shared values for both
        const sharedData: number[] = [
            this.tag.length, ...processCharCodes(this.tag),
            this.dontSpread ? 1 : 0,
            this.dataBatching, this.maxBatchSize,
            this.enumData.length, ...this.enumData.map(x => x.serialize()).flat(),
        ];

        // single-value packet (not an object schema)
        if (!this.object) {
            return [
                ...sharedData,           // shared
                0,                       // dummy byte flag for consistent deserialization; becomes -1 to indicate single
                ...this.serializeNumber(this.dataMax as number),  // the data max
                ...this.serializeNumber(this.dataMin as number),  // the data min
                this.type as PacketType, // type
            ];
        }

        // object packet
        return [
            ...sharedData,
            this.maxSize + 1,                                                 // size, and +1 because of 0 for single
            this.autoFlatten ? 1 : 0,                                         // auto flatten flag
            this.packetDelimitSize,
            ...(this.dataMax as number[]).map(this.serializeNumber).flat(), // all data maxes, serialized
            ...(this.dataMin as number[]).map(this.serializeNumber).flat(), // all data mins, serialized
            ...(this.type as PacketType[]),                                   // all types, offset by 1 for NULL
            this.tag.length,                                                  // tag length, offset by 1 for NULL
        ];
    }

    private static readVarInts(data: Uint8Array, offset: number, size: number): [res: number[], offset: number] {
        const res: number[] = [];
        for(let i=0;i<size;i++) {
            const [off, varint] = readVarInt(data, offset, false);
            offset = off;
            res.push(varint);
        }
        return [res, offset];
    }

    public static deserialize(data: Uint8Array, offset: number, client: boolean): [packet: Packet, offset: number] {
        const beginningOffset = offset;

        // read length, go up 1
        const tagLength: number = data[offset++];
        // read tag as it's up 1, and add offset
        const tag: string = asString(data.slice(offset, offset += tagLength));

        // then read dont spread, go up 1
        const dontSpread: boolean = data[offset++] == 1;

        // read batching, up 1
        const dataBatching: number = data[offset++];
        // read max batch size, up 1; can prob remove? idk
        const maxBatchSize: number = data[offset++];

        // read enum length, up 1
        const enumLength = data[offset++];
        const enums: EnumPackage[] = [];

        for (let i = 0; i < enumLength; i++) {
            // read tag length, go up 1
            const enumTagLength = data[offset++];
            // up 1 so read offset -> offset += tag length, to add tag length and skip over it
            const enumTag = asString(data.slice(offset, offset += enumTagLength));
            // read amount of values
            const valueCount = data[offset++];
            const values = [];
            for (let j = 0; j < valueCount; j++) {
                // read the length of the value, go up 1
                const valueLength = data[offset++];
                // then read the type of value, up 1
                const valueType = data[offset++];
                // now can just read the values, increase offset for later use
                const value = asString(data.slice(offset, offset += valueLength));
                // process it
                values.push(TYPE_CONVERSION_MAP[valueType](value));
            }
            // define the enum with the values
            enums.push(DefineEnum(enumTag, values));
        }

        // read type count; prob should change sometime
        const size: number = data[offset++] - 1;

        // objects
        // single packet is 0, 0 - 1 = -1
        if (size != -1) {
            // 1 for true, 0 for false
            const autoFlatten: boolean = data[offset++] == 1;
            // packet delimit size stuff
            const packetDelimitSize: number = data[offset++];

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
            const schema = PacketSchema.object(finalTypes, dataMaxes, dataMins, dontSpread, autoFlatten, packetDelimitSize, dataBatching, maxBatchSize, -1);
            return [
                new Packet(tag, schema, null, false, client),
                // +1 to go next
                (offset - beginningOffset) + 1,
            ];
        }

        // single packet

        // read varint for datamax
        const [o1, dataMax] = readVarInt(data, offset, false);
        offset = o1;

        // read varint for datamin
        const [o2, dataMin] = readVarInt(data, offset, false);
        offset = o2;

        // read type, no more so no +1
        const type: PacketType = data[offset] as PacketType;

        // do enum stuff
        const finalType = type == PacketType.ENUMS ? enums[0] : type; // convert enum to enum package

        // make schema
        const schema = PacketSchema.single(finalType, dataMax, dataMin, dontSpread, dataBatching, maxBatchSize, -1);
        return [
            new Packet(tag, schema, null, false, client),
            // +1 to go next
            (offset - beginningOffset) + 1,
        ];
    }
    
    public static deserializeAll(data: Uint8Array, client: boolean): Packet[] {
        const arr: Packet[] = [];

        let offset = 0;
        while(offset < data.length) {
            const [packet, len] = this.deserialize(data, offset, client);
            arr.push(packet);
            offset += len;
        }

        return arr;
    }
}

export class PacketSchema {

    public types: PacketType[] = [];
    public dataMaxes: number[] = [];
    public dataMins: number[] = [];

    public type: PacketType = PacketType.NONE;
    public dataMax: number = -1;
    public dataMin: number = -1;

    public packetDelimitSize: number = 1;

    public dataBatching: number = 0;
    public maxBatchSize: number = 10;

    public rateLimit: number = 0;

    public enumData: EnumPackage[] = [];

    public dontSpread: boolean = false;
    public autoFlatten: boolean = false;

    public object: boolean;

    constructor(object: boolean) {
        this.object = object;
    }

    public static single(type: PacketType | EnumPackage, dataMax: number, dataMin: number, dontSpread: boolean, dataBatching: number,
                         maxBatchSize: number, rateLimit: number): PacketSchema {
        const schema = new PacketSchema(false);

        if(typeof type == 'number') {
            schema.type = type as PacketType;
            if(type == PacketType.NONE) dataMax = dataMin = 0; // remove garbage data issues
        } else {
            schema.type = PacketType.ENUMS;
            schema.enumData = [type as EnumPackage];
        }

        schema.dataMax = dataMax;
        schema.dataMin = dataMin;
        schema.dontSpread = dontSpread;
        schema.dataBatching = dataBatching;
        schema.maxBatchSize = maxBatchSize;
        schema.rateLimit = rateLimit;

        return schema;
    }

    public static object(types: (PacketType | EnumPackage)[], dataMaxes: number[], dataMins: number[], dontSpread: boolean,
                         autoFlatten: boolean, packetDelimitSize: number, dataBatching: number, maxBatchSize: number, rateLimit: number): PacketSchema {
        if(types.length != dataMaxes.length || types.length != dataMins.length)
            throw new Error("There is an inbalance between the amount of types, data maxes, and data mins!");

        const schema = new PacketSchema(true);

        types.forEach(type => {
            if(typeof type == 'number') {
                schema.types.push(type as PacketType);
            } else {
                schema.types.push(PacketType.ENUMS);
                schema.enumData.push(type as EnumPackage);
            }
        });

        schema.dataMaxes = dataMaxes;
        schema.dataMins = dataMins;
        schema.dontSpread = dontSpread;
        schema.autoFlatten = autoFlatten;
        schema.packetDelimitSize = packetDelimitSize;
        schema.dataBatching = dataBatching;
        schema.maxBatchSize = maxBatchSize;
        schema.rateLimit = rateLimit;

        return schema;
    }
    
}