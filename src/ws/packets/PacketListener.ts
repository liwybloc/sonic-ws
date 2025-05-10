import { Packet } from "./Packets";

export class PacketListener {

    private listener: (...data: any[]) => void;
    private packet: Packet;

    constructor(packet: Packet, listener: (...data: any[]) => void) {
        this.listener = listener;
        this.packet = packet;
    }

    listen(value: string): boolean {
        try {
            if(!this.packet.validate(value)) return false;

            const processed = this.packet.processReceive(value);

            if(Array.isArray(processed) && !this.packet.dontSpread) this.listener(...processed);
            else this.listener(processed);
            return true;
        } catch (err) {
            console.error(err);
            return false;
        }
    }

}