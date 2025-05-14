import { Packet } from "./Packets";

export class PacketListener {

    private listener: (...data: any[]) => void;
    private packet: Packet;

    constructor(packet: Packet, listener: (...data: any[]) => void) {
        this.listener = listener;
        this.packet = packet;
    }

    public listen(processed: any, isArray: boolean): boolean {
        if(isArray && !this.packet.dontSpread) this.listener(...processed);
        else this.listener(processed);
        return true;
    }

}