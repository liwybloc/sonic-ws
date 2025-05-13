import fetch from 'node-fetch';
import * as WS from 'ws';
import { SonicWSConnection } from './SonicWSConnection';
import { PacketHolder } from '../util/PacketHolder';
import { MAX_C, NULL } from '../util/CodePointUtil';
import { VERSION, VERSION_CHAR } from '../../version';
import { Packet } from '../packets/Packets';

export class SonicWSServer {
    private wss: WS.WebSocketServer;
    private availableIds: number[] = Array.from({ length: 501 }, (_, i) => i);
    
    private connectListeners: Array<(client: SonicWSConnection) => void> = [];

    public clientPackets: PacketHolder;
    public serverPackets: PacketHolder;

    private connections: SonicWSConnection[] = [];
    private connectionMap: Record<number, SonicWSConnection> = {};

    private rateLimit: number = 50;

    private handshakePacket: string | null = null;

    /**
     * Initializes and hosts a websocket with sonic protocol
     * Rate limits can be set with wss.setRateLimit(x); it is defaulted at 50/second
     * @param clientPackets The packets that the client can send; CreatePacket() etc..
     * @param serverPackets The packets that the server can send; CreatePacket() etc..
     * @param options Default websocket options, such as port and server
     */
    constructor(clientPackets: Packet[], serverPackets: Packet[], options: WS.ServerOptions = {}) {
        this.wss = new WS.WebSocketServer(options);

        this.clientPackets = new PacketHolder(clientPackets);
        this.serverPackets = new PacketHolder(serverPackets);

        const s_clientPackets = this.clientPackets.serialize();
        const s_serverPackets = this.serverPackets.serialize();

        const keyData = "SWS" + VERSION_CHAR + s_clientPackets + NULL + s_serverPackets;

        this.wss.on('connection', (socket) => {
            const sonicConnection = new SonicWSConnection(socket, this, this.generateSocketID(), this.handshakePacket);

            // send tags to the client so it doesn't have to hard code them in
            socket.send(keyData + NULL + String.fromCharCode(this.rateLimit));

            this.connections.push(sonicConnection);
            this.connectionMap[sonicConnection.id] = sonicConnection;
            this.connectListeners.forEach(l => l(sonicConnection));

            socket.on('close', () => {
                this.connections.splice(this.connections.indexOf(sonicConnection), 1);
                delete this.connectionMap[sonicConnection.id];
                this.availableIds.push(sonicConnection.id);
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
        return this.availableIds.shift()!;
    }
    
    /**
     * Requires each client to send this packet upon initialization
     * 
     * Recreates this:
     * ```js
     * let initiated = false;
     * socket.on('init', () => {
     *  if(initiated) return socket.close();
     *  initiated = true;
     *  // process
     * });
     * 
     * socket.on('otherPacket', () => {
     *  if(!initiated) return socket.close();
     *  // process
     * })
     * ```
     * 
     * @param packet The tag of the packet to require as a handshake
     */
    public requireHandshake(packet: string) {
        if(!this.clientPackets.hasTag(packet)) throw new Error(`The client cannot send "${packet}" for handshake!`);
        this.handshakePacket = packet;
    }

    /**
     * Sets the rate limit for all clients
     * @param limit Amount of packets the sockets can send every second, or 0 for infinite
     */
    public setRateLimit(limit: number) {
        // so that i can store limits in 1 packet
        if(limit > MAX_C) {
            limit = 0;
            console.warn(`A rate limit above ${MAX_C} is considered infinite.`);
        }
        this.rateLimit = limit;
    }

    /**
     * Listens for whenever a client connects
     * @param runner Called when ready
     */
    public on_connect(runner: (client: SonicWSConnection) => void): void {
        this.connectListeners.push(runner);
    }

    /**
     * Listens for whenever the server is ready
     * @param runner Called when ready
     */
    public on_ready(runner: () => void): void {
        this.wss.on('listening', runner);
    }

    /**
     * Closes the server
     * @param callback Called when server closes
     */
    public shutdown(callback: (err?: Error) => void): void {
        this.wss.close(callback);
    }

     /**
     * Broadcasts a packet to all users connected, but with a filter
     * @param tag The tag to send
     * @param filter The filter for who to send to
     * @param values The values to send
     */
    public broadcastFiltered(tag: string, filter: (socket: SonicWSConnection) => boolean, ...values: any): void {
        this.connections.filter(filter).forEach(conn => conn.send(tag, ...values));
    }

        /**
     * Broadcasts a packet to all users connected
     * @param tag The tag to send
     * @param values The values to send
     */
    public broadcast(tag: string, ...values: any): void {
        this.broadcastFiltered(tag, () => true, ...values);
    }

    /**
     * @returns All users connected to the socket
     */
    public getConnected(): SonicWSConnection[] {
        return this.connections;
    }

    /**
     * @param id The socket id
     * @returns The socket
     */
    public getSocket(id: number): SonicWSConnection {
        return this.connectionMap[id];
    }

    /**
     * Closes a socket by id
     * @param id The socket id
     */
    public closeSocket(id: number): void {
        this.getSocket(id).close();
    }

}