import * as WS from 'ws';
import { SonicWSConnection } from './SonicWSConnection';
import { KeyHolder } from '../KeyHolder';

export class SonicWSServer {
    private wss: WS.WebSocketServer;

    public clientKeys: KeyHolder;
    public serverKeys: KeyHolder;

    constructor(ck: string[], sk: string[], options: WS.ServerOptions = {}) {
        this.wss = new WS.WebSocketServer(options);

        this.clientKeys = new KeyHolder(ck);
        this.serverKeys = new KeyHolder(sk);

        // send tags to the client so it doesn't have to hard code them in
        this.wss.on('headers', (headers: string[]) => {
            headers.push('S-ClientKeys: ' + ck.join(","));
            headers.push('S-ServerKeys: ' + sk.join(","));
        })
    }

    public on_connect(runner: (client: SonicWSConnection) => void): void {
        this.wss.on('connection', (socket) => runner(new SonicWSConnection(socket, this)));
    }

    public on_ready(runner: () => void): void {
        this.wss.on('listening', runner);
    }

}