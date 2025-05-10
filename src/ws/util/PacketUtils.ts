import { PacketHolder } from "../KeyHolder";
import { PacketSendProcessors, processSendObjPacket } from "../packets/PacketProcessors";
import { Packet, PacketType, PacketSchema } from "../packets/PacketType";
import { NULL } from "./CodePointUtil";

export function emitPacket(packets: PacketHolder, send: (data: string) => void, tag: string, ...values: any[]) {
    const code = packets.getChar(tag);
    if(code == NULL) throw new Error(`Tag "${tag}" has not been created!`);

    const packet = packets.getPacket(tag);
    if(values.length > packet.size) throw new Error(`Packet "${tag}" only allows ${packet.size} values!`);

    const data = packet.object ? processSendObjPacket(packet) : PacketSendProcessors[packet.type as PacketType](...values);
    send(code + data);
}

export function CreatePacket(tag: string, type: PacketType = PacketType.NONE, dataCap: number = 1, dontSpread: boolean = false) {
    return new Packet(tag, PacketSchema.single(type, dataCap, dontSpread));
}
export function CreateObjPacket(tag: string, types: PacketType[], dataCaps: number[], dontSpread: boolean = false) {
    return new Packet(tag, PacketSchema.object(types, dataCaps, dontSpread));
}