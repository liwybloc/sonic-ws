import { PacketReceiveProcessors, PacketValidityProcessors, Packet } from "./PacketType";

export class PacketListener {

    private processor: (data: string) => any;
    private validifier: (data: string, dataCap: number) => boolean;
    private listener: (...data: any[]) => void;
    private dontSpread: boolean;
    private dataCap: number;

    constructor(packet: Packet, listener: (...data: any[]) => void) {
        this.processor = PacketReceiveProcessors[packet.type];
        this.validifier = PacketValidityProcessors[packet.type];
        this.listener = listener;
        this.dontSpread = packet.dontSpread;
        this.dataCap = packet.dataCap;
    }

    listen(value: string): boolean {
        try {
            if(!this.validifier(value, this.dataCap)) return false;

            const processed = this.processor(value);

            if(Array.isArray(processed) && !this.dontSpread) this.listener(...processed);
            else this.listener(processed);
            return true;
        } catch (err) {
            return false;
        }
    }

}