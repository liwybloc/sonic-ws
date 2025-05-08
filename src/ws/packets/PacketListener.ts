import { PacketType, PacketReceiveProcessors } from "./PacketType";

export class PacketListener {

    private processor: (data: string) => any;
    private listener: (...data: any[]) => void;
    private dontSpread: boolean;

    constructor(type: PacketType, listener: (data: string) => void, dontSpread: boolean) {
        this.processor = PacketReceiveProcessors[type];
        this.listener = listener;
        this.dontSpread = dontSpread;
    }

    listen(value: string) {
        const processed = this.processor(value);

        if(Array.isArray(processed) && !this.dontSpread) this.listener(...processed);
        else this.listener(processed);
    }

}