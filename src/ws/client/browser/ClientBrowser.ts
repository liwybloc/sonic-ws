import { PacketType } from "../../packets/PacketType";
import { SonicWSCore } from "../core/ClientCore";

const w = window as any;

w.SonicWS = class SonicWS extends SonicWSCore {
    constructor(url: string, protocols?: string | string[]) {
        const ws = new WebSocket(url, protocols);
        super(ws);
    }

    static PacketType = PacketType;
}