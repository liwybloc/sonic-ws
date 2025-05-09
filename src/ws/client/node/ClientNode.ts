import WS from 'ws';
import { SonicWSCore } from '../core/ClientCore';

export class SonicWS extends SonicWSCore {
    constructor(url: string, options?: WS.ClientOptions) {
        const ws = new WS.WebSocket(url, options);
        super(ws as unknown as WebSocket);
    }
}