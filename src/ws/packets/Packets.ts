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
import { convertUBytePows, deconvertUBytePows, ETX, processCharCodes, STX } from "../util/packets/CompressionUtil";
import { UnFlattenData } from "../util/packets/PacketUtils";
import { createObjReceiveProcessor, createObjSendProcessor, createObjValidator, PacketReceiveProcessors, PacketSendProcessors, PacketValidityProcessors } from "./PacketProcessors";
import { PacketType } from "./PacketType";
import { Connection } from "../Connection";

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
        
        this.serializeBytePows = this.serializeBytePows.bind(this);
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

    private serializeBytePows(n: number) {
        return String.fromCharCode(...convertUBytePows(n, this.packetDelimitSize).map(x => x + 1));
    }

    public serialize(): string {
        // spread flag; ETX for "2", STX for "1", avoid NULL for delimiting
        const spreadFlag = this.dontSpread ? ETX : STX;
        // enum data, avoid null
        const enumData = String.fromCharCode(this.enumData.length + 1) + this.enumData.map(x => x.serialize()).join("");
        // data batching, also avoid null
        const dataBatching = String.fromCharCode(this.dataBatching + 1) + String.fromCharCode(this.maxBatchSize + 1);
        // rate limit, avoiding null again... ugh i should prob fix this with a map-
        const rateLimit = String.fromCharCode(this.rateLimit + 1);

        // single-value packet (not an object schema)
        if (!this.object) {
            return spreadFlag + dataBatching + rateLimit + enumData +
                STX +                                                // dummy byte flag for consistent deserialization; becomes -1 to indicate single
                String.fromCharCode((this.dataMax as number) + 1) +  // the data max, offset by 1 for NULL
                String.fromCharCode((this.dataMin as number) + 1) +  // the data min, offset by 1 for NULL
                String.fromCharCode((this.type as PacketType) + 1) + // the type, offset by 1 for NULL
                String.fromCharCode(this.tag.length + 1) +           // tag length, offset by 1 for NULL
                this.tag;                                            // the tag
        }

        // object packet
        return spreadFlag + dataBatching + rateLimit + enumData +
            String.fromCharCode(this.maxSize + 2) +                                     // size, and +2 because of NULL and STX (STX is for single)
            (this.autoFlatten ? ETX : STX) +                                            // auto flatten flag
            String.fromCharCode(this.packetDelimitSize + 1) +                           // packet delimit size, offset by 1 for NULL
            (this.dataMax as number[]).map(this.serializeBytePows).join("") +          // all data maxes, serialized
            (this.dataMin as number[]).map(this.serializeBytePows).join("") +          // all data mins, serialized
            (this.type as PacketType[]).map(x => String.fromCharCode(x + 1)).join("") + // all types, offset by 1 for NULL
            String.fromCharCode(this.tag.length + 1) +                                  // tag length, offset by 1 for NULL
            this.tag;                                                                   // the tag
    }

    private static processBytePows(area: string, packetDelimitSize: number) {
        return splitArray(processCharCodes(area), packetDelimitSize).map((x: number[]) => deconvertUBytePows(x.map(y => y - 1))); // subtract 1 to reverse
    }

    // i think i was high when i made these,
    // probably ^^
    public static deserialize(text: string, offset: number, client: boolean): [packet: Packet, offset: number] {
        const beginningOffset = offset;

        const dontSpread: boolean = text[offset] == ETX;

        const dataBatching: number = text.charCodeAt(++offset) - 1;
        const maxBatchSize: number = text.charCodeAt(++offset) - 1;

        const rateLimit: number = text.charCodeAt(++offset) - 1;

        const enumLength = text.charCodeAt(++offset) - 1;
        const enums: EnumPackage[] = [];

        for (let i = 0; i < enumLength; i++) {
            const enumTagLength = text.charCodeAt(++offset) - 1;
            const enumTag = text.slice(++offset, offset += enumTagLength);
            offset--;
            const valueCount = text.charCodeAt(++offset) - 1;
            const values = [];
            for (let j = 0; j < valueCount; j++) {
                const valueLength = text.charCodeAt(++offset) - 1;
                const valueType = text.charCodeAt(++offset) - 1;
                const value = text.slice(++offset, offset += valueLength);
                offset--;
                values.push(TYPE_CONVERSION_MAP[valueType](value));
            }
            enums.push(DefineEnum(enumTag, values));
        }

        const size: number = text.charCodeAt(++offset) - 2;

        // objects
        // the single packet is STX so STX - 2 = -1
        if (size != -1) {
            // ETX for true, STX for false
            const autoFlatten: boolean = text[++offset] == ETX;
            // delimiting size for huge packets
            const packetDelimitSize: number = text.charCodeAt(++offset) - 1;

            const areaSize = size * packetDelimitSize;

            const dcStart = ++offset;         // data maxes section start
            const dcEnd = dcStart + areaSize; // data maxes section end
            const dmStart = dcEnd;            // data mins section start
            const dmEnd = dmStart + areaSize; // data mins section end
            const tStart = dmEnd;             // types section start
            const tEnd = tStart + size;       // types section end
            const tagStart = tEnd + 1;        // tag string starts after tag length byte

            const dataMaxes: number[]  = this.processBytePows(text.substring(dcStart, dcEnd), packetDelimitSize);
            const dataMins: number[]   = this.processBytePows(text.substring(dmStart, dmEnd), packetDelimitSize);

            const types: PacketType[]  = processCharCodes(text.substring(tStart, tEnd)).map(x => x - 1);

            let index = 0;
            const finalTypes: (PacketType | EnumPackage)[] = types.map(x => x == PacketType.ENUMS ? enums[index++] : x); // convert enums to their enum packages

            const tagLength: number = text.charCodeAt(tagStart - 1) - 1; // tag length is right behind tag, subtracting 1 to reverse
            const tag = text.substring(tagStart, tagStart + tagLength); // tag is tag length long. yeah

            const schema = PacketSchema.object(finalTypes, dataMaxes, dataMins, dontSpread, autoFlatten, packetDelimitSize, dataBatching, maxBatchSize, rateLimit);
            return [
                new Packet(tag, schema, null, false, client),
                (offset - beginningOffset) + 1 + areaSize + areaSize + size + tagLength,
            ];
        }

        // single packet; subtracting 1 to revere.
        const dataMax: number = text.charCodeAt(++offset) - 1;
        const dataMin: number = text.charCodeAt(++offset) - 1;
        const type: PacketType = (text.charCodeAt(++offset) - 1) as PacketType;

        const finalType = type == PacketType.ENUMS ? enums[0] : type; // convert enum to enum package

        const tagStart = ++offset;
        const tagLength: number = text.charCodeAt(tagStart) - 1;
        const tag: string = text.substring(tagStart + 1, tagStart + 1 + tagLength);

        const schema = PacketSchema.single(finalType, dataMax, dataMin, dontSpread, dataBatching, maxBatchSize, rateLimit);
        return [
            new Packet(tag, schema, null, false, client),
            (offset - beginningOffset) + 1 + tagLength
        ];
    }
    
    public static deserializeAll(text: string, client: boolean): Packet[] {
        const arr: Packet[] = [];

        let offset = 0;
        while(offset < text.length) {
            const [packet, len] = this.deserialize(text, offset, client);
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