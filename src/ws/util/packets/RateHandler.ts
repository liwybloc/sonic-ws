import { SonicWSConnection } from "../../server/SonicWSConnection";
import { PacketHolder } from "./PacketHolder";

export class RateHandler {

    private rates: Record<string, number> = {};
    private limits: Record<string, number> = {};

    private setInterval: (call: () => void, time: number) => void;
    private socket: any;

    constructor(host: SonicWSConnection) {
        // shared values
        this.setInterval = host.setInterval;
        this.socket = host.socket;
    }

    public start() {
        // no rates? don't start an interval
        if(Object.keys(this.rates).length == 0) return;
        this.setInterval(() => {
            for (const tag in this.rates) {
                this.rates[tag] = 0;
            }
        }, 1000);
    }

    public registerRate(tag: string, limit: number) {
        // ignore no limits
        if(limit == 0) return;

        this.rates[tag] = 0;
        this.limits[tag] = limit;
    }

    public registerAll(packetHolder: PacketHolder, prefix: string) {
        const packets = packetHolder.getPackets();
        for(const packet of packets)
            this.registerRate(prefix + packetHolder.getChar(packet.tag), packet.rateLimit);
    }

    public trigger(tag: string | number): boolean {
        if(tag in this.rates && ++this.rates[tag] > this.limits[tag]) {
            this.socket.close(4000);
            return true;
        }
        return false;
    }

    public subtract(tag: string | number) {
        if(!(tag in this.rates)) return;
        this.rates[tag]--;
    }

}