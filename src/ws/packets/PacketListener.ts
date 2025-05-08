import { PacketType, PacketReceiveProcessors, PacketValidityProcessors } from "./PacketType";

export class PacketListener {

    private processor: (data: string) => any;
    private validifier: (data: string, dataCap: number) => boolean;
    private listener: (...data: any[]) => void;
    private dontSpread: boolean;
    private dataCap: number;

    constructor(type: PacketType, listener: (data: string) => void, dataCap: number, dontSpread: boolean) {
        this.processor = PacketReceiveProcessors[type];
        this.validifier = PacketValidityProcessors[type];
        this.listener = listener;
        this.dontSpread = dontSpread;
        this.dataCap = dataCap;
    }

    listen(value: string): boolean {
        // -1 if it's the client
        if(this.dataCap != -1 && !this.validifier(value, this.dataCap)) return false;

        const processed = this.processor(value);

        if(Array.isArray(processed) && !this.dontSpread) this.listener(...processed);
        else this.listener(processed);
        return true;
    }

}