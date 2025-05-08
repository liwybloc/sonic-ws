import { SonicWSCore } from "../core/ClientCore";

export class SonicWS extends SonicWSCore {
    constructor(url: string, protocols: string | string[]) {
        const ws = new WebSocket(url, protocols);
        super(ws);
    }
}