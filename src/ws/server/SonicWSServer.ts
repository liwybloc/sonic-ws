import * as WS from 'ws';
import { SonicWSConnection } from './SonicWSConnection';
import { KeyHolder } from '../KeyHolder';

export class SonicWSServer {
    private wss: WS.WebSocketServer;
    private socketIDs: number[] = [];
    
    private connectListeners: Array<(client: SonicWSConnection) => void> = [];

    public clientKeys: KeyHolder;
    public serverKeys: KeyHolder;

    public connections: SonicWSConnection[] = [];

    constructor(ck: string[], sk: string[], options: WS.ServerOptions = {}) {
        this.wss = new WS.WebSocketServer(options);

        this.clientKeys = new KeyHolder(ck);
        this.serverKeys = new KeyHolder(sk);

        this.wss.on('connection', (socket) => {
            const sonicConnection = new SonicWSConnection(socket, this, this.generateSocketID());

            // send tags to the client so it doesn't have to hard code them in
            socket.send("SWS" + ck.join(",") + ";" + sk.join(","));

            this.connections.push(sonicConnection);
            this.connectListeners.forEach(l => l(sonicConnection));

            socket.on('close', () => {
                this.connections.splice(this.connections.indexOf(sonicConnection), 1);
                this.socketIDs.splice(this.socketIDs.indexOf(sonicConnection.id), 1);
            });
        });
    }

    private generateSocketID(): number {
        let id;
        do id = Math.floor(Math.random() * 9999999);
        while (this.socketIDs.includes(id));
        return id;
    }

    public on_connect(runner: (client: SonicWSConnection) => void): void {
        this.connectListeners.push(runner);
    }

    public on_ready(runner: () => void): void {
        this.wss.on('listening', runner);
    }

}