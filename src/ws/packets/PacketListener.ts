import { Packet } from "./Packets";

export class PacketListener {

    private listener: (...data: any[]) => void;
    private packet: Packet;

    constructor(packet: Packet, listener: (...data: any[]) => void) {
        this.listener = listener;
        this.packet = packet;
    }

    public listen(value: string): boolean {
        let processed;
        try {
            if(!this.packet.validate(value)) return false;

            processed = this.packet.processReceive(value);
        } catch (err) {
            console.error("There was an error processing the packet! This is probably my fault... report at https://github.com/cutelittlelily/sonic-ws", err);
            return false;
        }
        if(Array.isArray(processed) && !this.packet.dontSpread) this.listener(...processed);
        else this.listener(processed);
        return true;
    }

}