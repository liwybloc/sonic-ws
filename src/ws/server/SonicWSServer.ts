import fetch from 'node-fetch';
import * as WS from 'ws';
import { SonicWSConnection } from './SonicWSConnection';
import { PacketHolder } from '../util/KeyHolder';
import { NULL } from '../util/CodePointUtil';
import { VERSION, VERSION_CHAR } from '../../version';
import { Packet } from '../packets/Packets';

export class SonicWSServer {
    private wss: WS.WebSocketServer;
    private currentId: number = 0;
    
    private connectListeners: Array<(client: SonicWSConnection) => void> = [];

    public clientPackets: PacketHolder;
    public serverPackets: PacketHolder;

    private connections: SonicWSConnection[] = [];
    private connectionMap: Record<number, SonicWSConnection> = {};

    constructor(clientPackets: Packet[], serverPackets: Packet[], options: WS.ServerOptions = {}) {
        this.wss = new WS.WebSocketServer(options);

        this.clientPackets = new PacketHolder(clientPackets);
        this.serverPackets = new PacketHolder(serverPackets);

        const s_clientPackets = this.clientPackets.serialize();
        const s_serverPackets = this.serverPackets.serialize();

        const keyData = "SWS" + VERSION_CHAR + s_clientPackets + NULL + s_serverPackets;

        this.wss.on('connection', (socket) => {
            const sonicConnection = new SonicWSConnection(socket, this, this.generateSocketID());

            // send tags to the client so it doesn't have to hard code them in
            socket.send(keyData);

            this.connections.push(sonicConnection);
            this.connectionMap[sonicConnection.id] = sonicConnection;
            this.connectListeners.forEach(l => l(sonicConnection));

            socket.on('close', () => {
                this.connections.splice(this.connections.indexOf(sonicConnection), 1);
                delete this.connectionMap[sonicConnection.id];
            });
        });

        fetch('https://raw.githubusercontent.com/cutelittlelily/sonic-ws/refs/heads/main/release/version')
            .then(res => res.text())
            .then(ver => {
                if(parseInt(ver) != VERSION) {
                    console.warn(`SonicWS is currently running outdated! (current: ${VERSION}, latest: ${ver}) Update with "npm update sonic-ws"`)
                }
            })
            .catch(err => {
                console.error(err);
                console.warn(`Could not check SonicWS version.`);
            });
    }

    private generateSocketID(): number {
        return this.currentId++;
    }

    public on_connect(runner: (client: SonicWSConnection) => void): void {
        this.connectListeners.push(runner);
    }

    public on_ready(runner: () => void): void {
        this.wss.on('listening', runner);
    }

    public shutdown(callback: (err?: Error) => void): void {
        this.wss.close(callback);
    }

    public broadcast(tag: string, ...values: any): void {
        this.connections.forEach(conn => conn.send(tag, ...values));
    }

    public getConnected(): SonicWSConnection[] {
        return this.connections;
    }
    public getSocket(id: number): SonicWSConnection {
        return this.connectionMap[id];
    }
    public closeSocket(id: number): void {
        this.getSocket(id).close();
    }

}