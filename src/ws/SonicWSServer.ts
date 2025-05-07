import * as WS from 'ws';
import { SonicWSClient } from './SonicWSClient';
import { KeyHolder } from './KeyHolder';

export class SonicWSServer {
    private ws: WS.WebSocketServer;

    public clientKeys: KeyHolder;
    public serverKeys: KeyHolder;

    constructor(options: WS.ServerOptions) {
        this.ws = new WS.WebSocketServer(options);

        this.clientKeys = new KeyHolder();
        this.serverKeys = new KeyHolder();
    }

    public createClientKeys(...keys: string[]) {
        this.clientKeys.createKeys(keys);
    }
    public createServerKeys(...keys: string[]) {
        this.serverKeys.createKeys(keys);
    }

    public on_connect(runner: (client: SonicWSClient) => void): void {
        this.ws.on('connection', (socket) => runner(new SonicWSClient(socket, this)));
    }

    public on_ready(runner: () => void): void {
        this.ws.on('listening', runner);
    }

}