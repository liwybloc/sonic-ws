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

import { DefineEnum } from "../enums/EnumHandler";
import { EnumPackage, TYPE_CONVERSION_MAP } from "../enums/EnumType";
import { splitArray } from "../util/ArrayUtil";
import { convertINT_D, deconvertINT_DCodes, ETX, processCharCodes, STX } from "../util/CodePointUtil";
import { UnFlattenData } from "../util/PacketUtils";
import { createObjReceiveProcessor, createObjSendProcessor, createObjValidator, PacketReceiveProcessors, PacketSendProcessors, PacketValidityProcessors } from "./PacketProcessors";
import { PacketType } from "./PacketType";

export class Packet {
    public tag: string;

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

    public object: boolean;
    
    private receiveProcessor: (data: string, cap: any, packet: Packet, index: number) => any;
    private sendProcessor: (...data: any[]) => string;
    private validifier: (data: string, cap: any, min: any, packet: Packet, index: number) => boolean;

    public processReceive: (data: string) => any;
    public processSend: (data: any[]) => string;
    public validate: (data: string) => boolean;
    public customValidator: ((...values: any[]) => boolean) | null;

    constructor(tag: string, schema: PacketSchema, customValidator: ((values: any[]) => boolean) | null, client: boolean) {
        this.tag = tag;
        
        this.enumData     = schema.enumData;
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
            this.sendProcessor    = createObjSendProcessor(this.type, this.packetDelimitSize);
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
        
        this.processReceive  = (data: string) => this.receiveProcessor(data, this.dataMax, this, 0);
        this.processSend     = (...data: any[]) => this.sendProcessor(...data.flat());
        this.validate        = client ? () => true : (data: string) => this.validifier(data, this.dataMax, this.dataMin, this, 0);
        this.customValidator = customValidator;
    }

    public listen(value: string): [processed: any, flatten: boolean] | string {
        try {
            if(!this.validate(value)) return "Invalid packet";

            const processed = this.processReceive(value);

            const useableData = this.autoFlatten ? UnFlattenData(processed) : processed;

            if(this.customValidator != null) {
                if(!this.dontSpread) {
                    if(!this.customValidator(...useableData)) return "Didn't pass custom validator";
                } else {
                    if(!this.customValidator(useableData)) return "Didn't pass custom validator";
                }
            }
            return [useableData, !this.dontSpread];
        } catch (err) {
            console.error("There was an error processing the packet! This is probably my fault... report at https://github.com/cutelittlelily/sonic-ws", err);
            return "Error: " + err;
        }
    }

    private serializeINT_D(n: number) {
        return String.fromCharCode(...processCharCodes(convertINT_D(n, this.packetDelimitSize)).map(x => x + 1));
    }

    public serialize(): string {
        // spread flag; ETX for "2", STX for "1", avoid NULL for delimiting
        const spreadFlag = this.dontSpread ? ETX : STX;
        // enum data, avoid null
        const enumData = String.fromCharCode(this.enumData.length + 1) + this.enumData.map(x => x.serialize()).join("");
        // data batching, also avoid null
        const dataBatching = String.fromCharCode(this.dataBatching + 1) + String.fromCharCode(this.maxBatchSize + 1);

        // single-value packet (not an object schema)
        if (!this.object) {
            return spreadFlag + dataBatching + enumData +
                STX +                                                // dummy byte flag for consistent deserialization; becomes -1 to indicate single
                String.fromCharCode((this.dataMax as number) + 1) +  // the data max, offset by 1 for NULL
                String.fromCharCode((this.dataMin as number) + 1) +  // the data min, offset by 1 for NULL
                String.fromCharCode((this.type as PacketType) + 1) + // the type, offset by 1 for NULL
                String.fromCharCode(this.tag.length + 1) +           // tag length, offset by 1 for NULL
                this.tag;                                            // the tag
        }

        // object packet
        return spreadFlag + dataBatching + enumData +
            String.fromCharCode(this.maxSize + 2) +                                     // size, and +2 because of NULL and STX (STX is for single)
            (this.autoFlatten ? ETX : STX) +                                            // auto flatten flag
            String.fromCharCode(this.packetDelimitSize + 1) +                           // packet delimit size, offset by 1 for NULL
            (this.dataMax as number[]).map(x => this.serializeINT_D(x)).join("") +      // all data maxes, serialized
            (this.dataMin as number[]).map(x => this.serializeINT_D(x)).join("") +      // all data mins, serialized
            (this.type as PacketType[]).map(x => String.fromCharCode(x + 1)).join("") + // all types, offset by 1 for NULL
            String.fromCharCode(this.tag.length + 1) +                                  // tag length, offset by 1 for NULL
            this.tag;                                                                   // the tag
    }

    private static processINT_Ds(area: string, packetDelimitSize: number) {
        return splitArray(processCharCodes(area), packetDelimitSize).map((x: number[]) => deconvertINT_DCodes(x.map(y => y - 1))); // subtract 1 to reverse
    }

    // i think i was high when i made these,
    // probably ^^
    public static deserialize(text: string, offset: number, client: boolean): [packet: Packet, offset: number] {
        const beginningOffset = offset;

        const dontSpread: boolean = text[offset] == ETX;

        const dataBatching: number = text.charCodeAt(++offset) - 1;
        const maxBatchSize: number = text.charCodeAt(++offset) - 1;

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

            const dataMaxes: number[]  = this.processINT_Ds(text.substring(dcStart, dcEnd), packetDelimitSize);
            const dataMins: number[]   = this.processINT_Ds(text.substring(dmStart, dmEnd), packetDelimitSize);

            const types: PacketType[]  = processCharCodes(text.substring(tStart, tEnd)).map(x => x - 1);

            let index = 0;
            const finalTypes: (PacketType | EnumPackage)[] = types.map(x => x == PacketType.ENUMS ? enums[index++] : x); // convert enums to their enum packages

            const tagLength: number = text.charCodeAt(tagStart - 1) - 1; // tag length is right behind tag, subtracting 1 to reverse
            const tag = text.substring(tagStart, tagStart + tagLength); // tag is tag length long. yeah

            return [
                new Packet(tag, PacketSchema.object(finalTypes, dataMaxes, dataMins, dontSpread, autoFlatten, packetDelimitSize, dataBatching, maxBatchSize), null, client),
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

        return [
            new Packet(tag, PacketSchema.single(finalType, dataMax, dataMin, dontSpread, dataBatching, maxBatchSize), null, client),
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

    public enumData: EnumPackage[] = [];

    public dontSpread: boolean = false;
    public autoFlatten: boolean = false;

    public object: boolean;

    constructor(object: boolean) {
        this.object = object;
    }

    public static single(type: PacketType | EnumPackage, dataMax: number, dataMin: number, dontSpread: boolean, dataBatching: number, maxBatchSize: number): PacketSchema {
        const schema = new PacketSchema(false);

        if(typeof type == 'number') {
            schema.type = type as PacketType;
        } else {
            schema.type = PacketType.ENUMS;
            schema.enumData = [type as EnumPackage];
        }

        schema.dataMax = dataMax;
        schema.dataMin = dataMin;
        schema.dontSpread = dontSpread;
        schema.dataBatching = dataBatching;

        return schema;
    }

    public static object(types: (PacketType | EnumPackage)[], dataMaxes: number[], dataMins: number[],
                         dontSpread: boolean, autoFlatten: boolean, packetDelimitSize: number, dataBatching: number, maxBatchSize: number): PacketSchema {
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

        return schema;
    }
    
}