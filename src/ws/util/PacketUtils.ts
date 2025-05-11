import { PacketHolder } from "./KeyHolder";
import { Packet, PacketSchema } from "../packets/Packets";
import { PacketType } from "../packets/PacketType";
import { NULL, MAX_C } from "./CodePointUtil";

export function emitPacket(packets: PacketHolder, send: (data: string) => void, tag: string, values: any[]) {
    const code = packets.getChar(tag);
    if(code == NULL) throw new Error(`Tag "${tag}" has not been created!`);

    const packet = packets.getPacket(tag);
    if(values.length > packet.size) throw new Error(`Packet "${tag}" only allows ${packet.size} values!`);

    send(code + packet.processSend(values));
}

function isValidType(type: any): boolean {
    return typeof type == 'number' && type in PacketType;
}

export function CreatePacket(tag: string, type: PacketType = PacketType.NONE, dataCap: number = 1, dontSpread: boolean = false) {
    if(!isValidType(type)) throw new Error("Invalid packet type: " + type);
    dataCap = Math.min(dataCap, MAX_C);
    return new Packet(tag, PacketSchema.single(type, dataCap, dontSpread));
}
export function CreateObjPacket(tag: string, types: PacketType[], dataCaps: number[], dontSpread: boolean = false) {
    const invalid = types.find(type => !isValidType(type));
    if(invalid) throw new Error("Invalid packet type: " + invalid);
    dataCaps = dataCaps.map(x => Math.min(x, MAX_C));
    return new Packet(tag, PacketSchema.object(types, dataCaps, dontSpread));
}