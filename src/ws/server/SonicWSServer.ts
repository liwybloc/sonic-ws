/*
 * Copyright 2025 Lily (cutelittlelily)
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import fetch from 'node-fetch';
import * as WS from 'ws';
import { SonicWSConnection } from './SonicWSConnection';
import { PacketHolder } from '../util/packets/PacketHolder';
import { convertVarInt, MAX_BYTE, NULL } from '../util/packets/CompressionUtil';
import { SERVER_SUFFIX_NUMS, VERSION } from '../../version';
import { processPacket } from '../util/packets/PacketUtils';
import { Packet } from '../packets/Packets';

/**
 * Sonic WS Server Options
 */
export type SonicServerOptions = {
    /** An array of packets the client can send and server can listen for; using CreatePacket(), CreateObjPacket(), and CreateEnumPacket() */
    clientPackets?: Packet[],
    /** An array of packets the server can send and client can listen for; using CreatePacket(), CreateObjPacket(), and CreateEnumPacket() */
    serverPackets?: Packet[],
    /** Default WS Options */
    websocketOptions?: WS.ServerOptions;
}

export class SonicWSServer {
    private wss: WS.WebSocketServer;

    private availableIds: number[] = [];
    private lastId: number = 0;
    
    private connectListeners: Array<(client: SonicWSConnection) => void> = [];

    public clientPackets: PacketHolder;
    public serverPackets: PacketHolder;

    private connections: SonicWSConnection[] = [];
    private connectionMap: Record<number, SonicWSConnection> = {};

    private clientRateLimit: number = 500;
    private serverRateLimit: number = 500;

    private handshakePacket: string | null = null;

    private maxConnections: number = 0;
    private queueTime: number = 10000;

    /**
     * Initializes and hosts a websocket with sonic protocol
     * Rate limits can be set with wss.setClientRateLimit(x) and wss.setServerRateLimit(x); it is defaulted at 500/second per both
     * @param settings Sonic Server Options such as schema data for client and server packets, alongside websocket options
     */
    constructor(settings: SonicServerOptions) {
        const { clientPackets = [], serverPackets = [], websocketOptions = {} } = settings;
 
        this.wss = new WS.WebSocketServer(websocketOptions);

        this.clientPackets = new PacketHolder(clientPackets);
        this.serverPackets = new PacketHolder(serverPackets);

        const s_clientPackets = this.clientPackets.serialize();
        const s_serverPackets = this.serverPackets.serialize();

        const keyData: number[] = [...SERVER_SUFFIX_NUMS, VERSION, ...convertVarInt(s_clientPackets.length, false), ...s_clientPackets, ...s_serverPackets];
        const retryData = new Uint8Array(SERVER_SUFFIX_NUMS);

        this.wss.on('connection', (socket) => {
            if(this.maxConnections != 0 && this.connections.length >= this.maxConnections) {
                socket.send(retryData);
                socket.close(1013);
                return;
            }

            const sonicConnection = new SonicWSConnection(socket, this, this.generateSocketID(), this.handshakePacket, this.clientRateLimit, this.serverRateLimit);

            // send tags to the client so it doesn't have to hard code them in
            socket.send(new Uint8Array([...keyData, sonicConnection.id]));

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
        if(this.availableIds.length == 0) this.availableIds.push(this.lastId + 1);
        this.lastId = this.availableIds.shift()!;
        return this.lastId;
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
        if(!this.clientPackets.hasTag(packet)) throw new Error(`The client does not send "${packet}" and so it cannot use it as a handshake!`);
        if(this.clientPackets.getPacket(packet).dataBatching != 0) throw new Error(`The packet "${packet}" is a batched packet, and cannot be used as a handshake!`);
        this.handshakePacket = packet;
    }

    /**
     * Sets the rate limit for all client-side packets
     * @param limit Amount of packets the sockets can send every second, or 0 for infinite
     */
    public setClientRateLimit(limit: number) {
        // so that i can store limits in 1 packet
        if(limit > MAX_BYTE) {
            limit = 0;
            console.warn(`A rate limit above ${MAX_BYTE} is considered infinite.`);
        }
        this.clientRateLimit = limit;
    }

    /**
     * Sets the rate limit for server-side packets per-socket
     * @param limit Amount of packets the server can send every second, or 0 for infinite
     */
    public setServerRateLimit(limit: number) {
        // so that i can store limits in 1 packet
        if(limit > MAX_BYTE) {
            limit = 0;
            console.warn(`A rate limit above ${MAX_BYTE} is considered infinite.`);
        }
        this.serverRateLimit = limit;
    }

    /**
     * Enables a packet for all current & new clients.
     * @param tag The tag of the packet
     */
    public enablePacket(tag: string) {
        this.clientPackets.getPacket(tag).defaultEnabled = true;
        this.connections.forEach(socket => socket.enablePacket(tag));
    }

    /**
     * Disables a packet for all current & new clients.
     * @param tag The tag of the packet
     */
    public disablePacket(tag: string) {
        this.clientPackets.getPacket(tag).defaultEnabled = false;
        this.connections.forEach(socket => socket.disablePacket(tag));
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
        const data = processPacket(this.serverPackets, tag, values);
        this.connections.filter(filter).forEach(conn => conn.send_processed(...data));
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
     * Sets the maximum amount of users that can be connected; will tell about wss.setQueueTime(time). Defaults to unlimited
     * @param amount The amount of users that can be connected
     */
    public setMaxConnections(amount: number): void {
        if(amount < 1) throw new Error(`Max connections must be at least 1: ${amount}`);
        this.maxConnections = amount;
    }

    /**
     * Sets the time in milliseconds for queued users to attempt to retry; applies for wss.setMaxConnections(amt). Defaults to 10,000ms
     * @param time The requested reconnect time
     */
    public setQueueTimeMs(time: number): void {
        if(time < 1) throw new Error(`Queue time must be at least 1ms: ${time}ms`);
        this.queueTime = time;
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