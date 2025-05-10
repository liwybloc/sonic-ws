import { ETX, NULL, processCharCodes, STX } from "../util/CodePointUtil";

export enum PacketType {
 
    /** No data */
    NONE = 0,

    /** Raw data */
    RAW = 1,

    /** Strings */
    STRINGS = 2,

    /** One or more numbers from -27,648 to 27,647 */
    INTS_C = 3,

    /** One or more numbers of any size. Similar maximum size will produce maximum efficiency */
    INTS_D = 4,

    /** One or more numbers of any size. More efficient for differently sized numbers, worse than INTS_D for similar sized numbers. */
    INTS_A = 5,

    /** One or more decimal numbers of any size */
    DECIMALS = 6,

    /** One or more true/false */
    BOOLEANS = 7,
    
}

export class Packet {
    public tag: string;

    public size: number;
    public type: PacketType | PacketType[];
    public dataCap: number | number[];
    public dontSpread: boolean;

    public object: boolean;

    constructor(tag: string, schema: PacketSchema) {
        this.tag = tag;

        if(schema.object) {
            this.type = schema.types;
            this.dataCap = schema.dataCaps;
            this.size = this.type.length;
            this.object = true;
        } else {
            this.type = schema.type;
            this.dataCap = schema.dataCap;
            this.size = this.dataCap;
            this.object = false;
        }

        this.dontSpread = schema.dontSpread;
    }

    public serialize(): string {
        // spread flag; ETX for "2", STX for "1", avoid NULL for delimiting
        const spreadFlag = this.dontSpread ? ETX : STX;

        // single-value packet (not an object schema)
        if (!this.object) {
            return spreadFlag +
                STX +                                                // Dummy size byte for consistent deserialization
                String.fromCharCode((this.dataCap as number) + 1) +  // 1 byte: Data cap, offset by +1 to avoid NULL
                String.fromCharCode((this.type as PacketType) + 1) + // 1 byte: Type, offset by +1
                String.fromCharCode(this.tag.length + 1) +           // 1 byte: Tag length, offset by +1
                this.tag;                                            // N bytes: Tag string
        }

        // object packet
        return spreadFlag +
            String.fromCharCode(this.size + 2) +                                  // size, and +2 because of NULL and STX (STX is for single)
            String.fromCharCode(...(this.dataCap as number[]).map(x => x + 1)) +  // all data caps, offset by 1 for NULL
            String.fromCharCode(...(this.type as PacketType[]).map(x => x + 1)) + // all types, offset by 1 for NULL
            String.fromCharCode(this.tag.length + 1) +                            // tag length, offset by 1 for NULL
            this.tag;                                                             // the tag
    }

    public static deserialize(text: string, offset: number): [packet: Packet, offset: number] {
        const dontSpread: boolean = text[offset] == ETX;

        const size: number = text.charCodeAt(offset + 1) - 2;

        // objects
        // the single packet is STX so STX - 2 = -1
        if (size != -1) {
            const dcStart = offset + 2;           // data caps section start
            const dcEnd = dcStart + size;         // data caps section end
            const tStart = dcEnd;                 // types section start
            const tEnd = tStart + size;           // types section end
            const tagStart = tEnd + 1;            // tag string starts after tag length byte

            const dataCaps: number[]  = processCharCodes(text.substring(dcStart, dcEnd)).map(x => x - 1); // subtract 1 to reverse
            const types: PacketType[] = processCharCodes(text.substring(tStart,   tEnd)).map(x => x - 1); // subtract 1 to reverse

            const tagLength: number = text.charCodeAt(tagStart - 1) - 1; // tag length is right behind tag, subtracting 1 to reverse
            const tag = text.substring(tagStart, tagStart + tagLength); // tag is tag length long. yeah

            return [
                new Packet(tag, PacketSchema.object(types, dataCaps, dontSpread)),
                3 + size + size + tagLength // the length of spread flag + size flag + tag length flag, then the 2 sizes for data caps and types
            ];
        }

        // single packet; subtracting 1 to revere.
        const dataCap: number = text.charCodeAt(offset + 2) - 1;
        const type: PacketType = (text.charCodeAt(offset + 3) - 1) as PacketType;

        const tagStart = offset + 5;
        const tagLength: number = text.charCodeAt(tagStart - 1) - 1;
        const tag: string = text.substring(tagStart, tagStart + tagLength);

        return [
            new Packet(tag, PacketSchema.single(type, dataCap, dontSpread)),
            5 + tagLength // the length of spread flag + single flag + data cap flag + type flag + tag flag + tag
        ];
    }
    
    public static deserializeAll(text: string): Packet[] {
        const arr: Packet[] = [];

        let offset = 0;
        while(offset < text.length) {
            const [packet, len] = this.deserialize(text, offset);
            arr.push(packet);
            offset += len;
        }

        return arr;
    }
}

export class PacketSchema {

    public types: PacketType[] = [];
    public dataCaps: number[] = [];

    public type: PacketType = PacketType.NONE;
    public dataCap: number = -1;

    public dontSpread: boolean = false;
    public object: boolean;

    constructor(object: boolean) {
        this.object = object;
    }

    public static single(type: PacketType, dataCap: number, dontSpread: boolean): PacketSchema {
        const schema = new PacketSchema(false);
        schema.type = type;
        schema.dataCap = dataCap;
        schema.dontSpread = dontSpread;
        return schema;
    }

    public static object(types: PacketType[], dataCaps: number[], dontSpread: boolean): PacketSchema {
        if(types.length != dataCaps.length) throw new Error("There is an inbalance between types and datacaps!");
        const schema = new PacketSchema(true);
        schema.types = types;
        schema.dataCaps = dataCaps;
        schema.dontSpread = dontSpread;
        return schema;
    }
    
}