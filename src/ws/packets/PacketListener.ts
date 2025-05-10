import { PacketReceiveProcessors, PacketValidityProcessors, processReceiveObjPacket, validateObjPacket } from "./PacketProcessors";
import { Packet, PacketType } from "./PacketType";

export class PacketListener {

    private processor: (data: string, cap: any) => any;
    private validifier: (data: string, dataCap: any) => boolean;
    private listener: (...data: any[]) => void;
    private dontSpread: boolean;
    private dataCap: number | number[];

    constructor(packet: Packet, listener: (...data: any[]) => void) {
        if(packet.object) {
            this.processor = processReceiveObjPacket;
            this.validifier = validateObjPacket;
        } else {
            this.processor = PacketReceiveProcessors[packet.type as PacketType];
            this.validifier = PacketValidityProcessors[packet.type as PacketType];
        }
        this.listener = listener;
        this.dontSpread = packet.dontSpread;
        this.dataCap = packet.dataCap;
    }

    listen(value: string): boolean {
        try {
            if(!this.validifier(value, this.dataCap)) return false;

            const processed = this.processor(value, this.dataCap);

            if(Array.isArray(processed) && !this.dontSpread) this.listener(...processed);
            else this.listener(processed);
            return true;
        } catch (err) {
            console.error(err);
            return false;
        }
    }

}