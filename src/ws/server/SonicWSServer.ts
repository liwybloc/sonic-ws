import * as WS from 'ws';
import { SonicWSConnection } from './SonicWSConnection';
import { PacketHolder } from '../KeyHolder';
import { Packet } from '../packets/PacketType';
import { NULL } from '../util/CodePointUtil';

export class SonicWSServer {
    private wss: WS.WebSocketServer;
    private socketIDs: number[] = [];
    
    private connectListeners: Array<(client: SonicWSConnection) => void> = [];

    public clientPackets: PacketHolder;
    public serverPackets: PacketHolder;

    public connections: SonicWSConnection[] = [];

    constructor(clientPackets: Packet[], serverPackets: Packet[], options: WS.ServerOptions = {}) {
        this.wss = new WS.WebSocketServer(options);

        this.clientPackets = new PacketHolder(clientPackets);
        this.serverPackets = new PacketHolder(serverPackets);

        this.wss.on('connection', (socket) => {
            const sonicConnection = new SonicWSConnection(socket, this, this.generateSocketID());

            // send tags to the client so it doesn't have to hard code them in
            socket.send("SWS" + this.clientPackets.serialize() + NULL + this.serverPackets.serialize());

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