/*
 * Copyright (c) 2026 Lily (liwybloc)
 *
 * Licensed for personal, non-commercial use only.
 * Commercial use, redistribution, sublicensing, sale, rental, lease,
 * or inclusion in a paid product or service is prohibited without prior
 * written permission from the copyright holder.
 *
 * See the LICENSE file in the project root for the full license terms.
 *
 * License-Identifier: LicenseRef-Lily-Personal-NonCommercial-2026
 */

import * as WS from 'ws';
import { SonicWSConnection } from "./SonicWSConnection";
import { PacketHolder } from "../util/packets/PacketHolder";
import { compressGzip, convertVarInt, MAX_BYTE } from "../util/packets/CompressionUtil";
import { SERVER_SUFFIX_NUMS, VERSION } from "../../version";
import { processPacket } from "../util/packets/PacketUtils";
import { Packet } from "../packets/Packets";
import { PacketType } from "../packets/PacketType";
import { MiddlewareHolder, SendQueue, ServerMiddleware } from "../PacketProcessor";
import { setHashFunc } from "../util/packets/HashUtil";
import { CloseCodes } from "../Connection";
import { DebugServer } from "../debug/DebugServer";

export type SonicServerSettings = {
    /** If it should check for updates; defaults to true. */
    readonly checkForUpdates?: boolean;
    /** If the rereference should use a 64 bit hash which is less prone to collision (1% after ~600 million) or a 32 bit hash. Defaults to true. */
    readonly bit64Hash?: boolean;
};

/**
 * Sonic WS Server Options
 */
export type SonicServerOptions = {
    /** An array of packets the client can send and server can listen for; using CreatePacket(), CreateObjPacket(), and CreateEnumPacket() */
    readonly clientPackets?: PacketTypings,
    /** An array of packets the server can send and client can listen for; using CreatePacket(), CreateObjPacket(), and CreateEnumPacket() */
    readonly serverPackets?: PacketTypings,
    /** Default WS Options */
    readonly websocketOptions?: WS.ServerOptions;
    readonly sonicServerSettings?: SonicServerSettings;
}

export type PacketTypings = readonly Packet<PacketType | readonly PacketType[]>[];

export class SonicWSServer extends MiddlewareHolder<ServerMiddleware> {
    private wss: WS.WebSocketServer;

    private availableIds: number[] = [];
    private lastId: number = 0;
    
    private connectListeners: Array<(client: SonicWSConnection) => void> = [];

    public clientPackets: PacketHolder;
    public serverPackets: PacketHolder;

    connections: SonicWSConnection[] = [];
    connectionMap: Record<number, SonicWSConnection> = {};

    private clientRateLimit: number = 500;
    private serverRateLimit: number = 500;

    private handshakePacket: string | null = null;

    tags: Map<SonicWSConnection, Set<String>> = new Map();
    tagsInv: Map<String, Set<SonicWSConnection>> = new Map();

    private serverwideSendQueue: SendQueue = [false, [], undefined];

    /**
     * Initializes and hosts a websocket with sonic protocol
     * Rate limits can be set with wss.setClientRateLimit(x) and wss.setServerRateLimit(x); it is defaulted at 500/second per both
     * @param settings Sonic Server Options such as schema data for client and server packets, alongside websocket options
     */ 
    constructor(settings: SonicServerOptions) {
        super();

        const { clientPackets = [], serverPackets = [], websocketOptions = {} } = settings;
 
        this.wss = new WS.WebSocketServer(websocketOptions);

        this.clientPackets = new PacketHolder(clientPackets);
        this.serverPackets = new PacketHolder(serverPackets);

        const s_clientPackets = this.clientPackets.serialize();
        const s_serverPackets = this.serverPackets.serialize();

        const serverData = [...SERVER_SUFFIX_NUMS, VERSION];
        const keyData: number[] = [...convertVarInt(s_clientPackets.length), ...s_clientPackets, ...s_serverPackets];

        setHashFunc(settings.sonicServerSettings?.bit64Hash ?? true);

        this.wss.on('connection', async (socket) => {
            const sonicConnection = new SonicWSConnection(socket, this, this.generateSocketID(), this.handshakePacket, this.clientRateLimit, this.serverRateLimit);

            if(await this.callMiddleware("onClientConnect", sonicConnection)) {
                sonicConnection.close(CloseCodes.MIDDLEWARE, "Connection blocked by middleware.");
                this.callMiddleware("onClientDisconnect", sonicConnection, CloseCodes.MIDDLEWARE, Buffer.from("Connection blocked by middleware."));
                this.availableIds.push(sonicConnection.id);
                return;
            }

            // send tags to the client so it doesn't have to hard code them in
            const data = new Uint8Array([...convertVarInt(sonicConnection.id), ...keyData]);
            socket.send([...serverData, ...await compressGzip(data)]);

            this.connections.push(sonicConnection);
            this.connectionMap[sonicConnection.id] = sonicConnection;
            this.connectListeners.forEach(l => l(sonicConnection));

            socket.on('close', (code, reason) => {
                this.connections.splice(this.connections.indexOf(sonicConnection), 1);
                delete this.connectionMap[sonicConnection.id];
                this.availableIds.push(sonicConnection.id);
                if(this.tags.has(sonicConnection)) {
                    for(const tag of this.tags.get(sonicConnection)!) this.tagsInv.get(tag)?.delete(sonicConnection);
                    this.tags.delete(sonicConnection);
                }
                this.callMiddleware("onClientDisconnect", sonicConnection, code, reason);
            });
        });

        if(settings.sonicServerSettings?.checkForUpdates ?? true) {
            fetch('https://raw.githubusercontent.com/liwybloc/sonic-ws/refs/heads/main/release/version')
                .then((res: Response) => res.text())
                .then((ver: string) => {
                    if(parseInt(ver) > VERSION) {
                        console.warn(`SonicWS is currently running outdated! (current: ${VERSION}, latest: ${ver}) Update with "npm update sonic-ws"`)
                    }
                })
                .catch((err: Error) => {
                    console.error(err);
                    console.warn(`Could not check SonicWS version.`);
                });
        }
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

    private async broadcastInternal(
        packetTag: string,
        target:
            | { type: "all" }
            | { type: "tagged"; tag: string }
            | { type: "filter"; filter: (socket: SonicWSConnection) => boolean },
        values: any[]
    ): Promise<void> {

        let recipients: SonicWSConnection[];

        if (target.type === "all") {
            recipients = this.connections;
        } else if (target.type === "tagged") {
            if (!this.tagsInv.has(target.tag)) return;
            recipients = Array.from(this.tagsInv.get(target.tag)!);
        } else {
            recipients = this.connections.filter(target.filter);
        }

        if (await this.callMiddleware("onPacketBroadcast_pre", packetTag, {recipients, ...target}, values)) return;

        if (recipients.length === 0) return;

        const [code, data, packet] = await processPacket(
            this.serverPackets,
            packetTag,
            values,
            this.serverwideSendQueue,
            -1
        );

        if (await this.callMiddleware("onPacketBroadcast_post", packetTag, {recipients, ...target}, data, data.length)) return;
        recipients.forEach(conn => conn.send_processed(code, data, packet));
    }

    public async broadcastTagged(tag: string, packetTag: string, ...values: any): Promise<void> {
        await this.broadcastInternal(packetTag, { type: "tagged", tag }, values);
    }

    public async broadcastFiltered(
        tag: string,
        filter: (socket: SonicWSConnection) => boolean,
        ...values: any
    ): Promise<void> {
        await this.broadcastInternal(tag, { type: "filter", filter }, values);
    }

    public async broadcast(tag: string, ...values: any): Promise<void> {
        await this.broadcastInternal(tag, { type: "all" }, values);
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
    public closeSocket(id: number, code: number = 1000, reason?: string | Buffer): void {
        this.getSocket(id).close(code, reason);
    }

    /**
     * Tags the socket with a key
     * @param socket The socket to tag
     * @param tag The tag to add
     * @param replace If it should replace a previous tag; defaults to true. If using false, you can add multiple tags.
     */
    public tag(socket: SonicWSConnection, tag: string, replace: boolean = true) {
        if(!this.tags.get(socket)) this.tags.set(socket, new Set());
        if(!this.tagsInv.get(tag)) this.tagsInv.set(tag, new Set());
        if(replace) {
            this.tags.get(socket)!.forEach(v => this.tagsInv.get(v)?.delete(socket));
        }
        this.tags.get(socket)!.add(tag);
        this.tagsInv.get(tag)!.add(socket);
    }

    private debugServer: DebugServer | null = null;

    /**
     * Opens a debug menu; this launches the browser and starts a subserver
     * @param port Port of the server/http, defaults to 0 which finds an open port
     * @param password Toggles the requirement of a password to access the server. Defaults to empty, which doesn't ask for a password.
     */
    public OpenDebug(data: {port?: number, password?: string} = {}) {
        if (this.debugServer != null) throw new Error("Attempted to open a debug server when one has already been opened.");
        this.debugServer = new DebugServer(this, data);
    }

}