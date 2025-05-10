import { PacketHolder } from "../KeyHolder";
import { Packet, PacketSendProcessors, PacketType } from "../packets/PacketType";
import { NULL } from "./CodePointUtil";

export function CreatePacket(tag: string, type: PacketType = PacketType.NONE, dataCap: number = 1, dontSpread: boolean = false) {
    return new Packet(tag, type, dataCap, dontSpread);
}

export function emitPacket(packets: PacketHolder, send: (data: string) => void, tag: string, ...values: any[]) {
    const code = packets.getChar(tag);
    if(code == NULL) throw new Error(`Tag "${tag}" has not been created!`);

    const packet = packets.getPacket(tag);
    if(values.length > packet.dataCap) throw new Error(`Packet "${tag}" only allows ${packet.dataCap} values!`);

    const data = code + PacketSendProcessors[packet.type](...values);
    send(data);
}