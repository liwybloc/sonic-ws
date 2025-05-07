import * as WS from 'ws';
import { SonicWSClient } from './SonicWSClient';

export class SonicWSServer {
    private ws: WS.WebSocketServer;
    private key: number;
    public keys: Record<string, number>;

    constructor(options: WS.ServerOptions) {
        this.ws = new WS.WebSocketServer(options);
        this.key = ' '.codePointAt(0)!;
        this.keys = {};
    }

    public on_connect(runner: (client: SonicWSClient) => void): void {
        this.ws.on('connection', (socket) => runner(new SonicWSClient(socket, this)));
    }

    public on_ready(runner: () => void): void {
        this.ws.on('listening', runner);
    }

    /** Creates a key; remember to keep keys created in the same order as the client */
    public createKey(tag: string): void {
        this.key++;
        this.keys[tag] = this.key;
    }
    /** Creates multiple keys; remember to keep keys created in the same order as the client */
    public createKeys(...tags: string[]): void {
        for (const tag of tags) this.createKey(tag);
    }
}