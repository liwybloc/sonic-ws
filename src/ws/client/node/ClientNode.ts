import WS from 'ws';
import { IncomingMessage } from 'http';
import { SonicWSCore } from '../core/ClientCore';

export class SonicWS extends SonicWSCore {
    constructor(url: string, options?: WS.ClientOptions) {
        const ws = new WS.WebSocket(url, options);
        super(ws as unknown as WebSocket); // Cast to match browser WebSocket interface

        ws.on('upgrade', (req: IncomingMessage) => {
            this._finishInit(req.headers);
        });
    }
}