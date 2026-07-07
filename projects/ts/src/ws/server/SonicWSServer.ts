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
import type { Server as HTTPServer, IncomingMessage, ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { SonicWSConnection } from "./SonicWSConnection";
import { PacketHolder } from "../util/packets/PacketHolder";
import { convertVarInt, MAX_USHORT } from "../util/packets/CompressionUtil";
import { deflateNative } from "../../native/wrapper";
import { SERVER_SUFFIX_NUMS, VERSION } from "../../version";
import { processPacket } from "../util/packets/PacketUtils";
import { Packet } from "../packets/Packets";
import { PacketType } from "../packets/PacketType";
import { MiddlewareHolder, SendQueue, ServerMiddleware } from "../PacketProcessor";
import { setHashFunc } from "../util/packets/HashUtil";
import { CloseCodes } from "../Connection";
import { DebugServer } from "../debug/DebugServer";
import { randomUUID } from "node:crypto";
import type { AdapterBroadcast, SonicWSAdapter } from "./Adapter";
import { encodeReplay, encodeResumed } from "../util/packets/ControlProtocol";

function normalizeRateLimit(limit: number): number {
    if (!Number.isFinite(limit) || limit < 0) {
        throw new Error("Rate limit must be a non-negative finite number");
    }

    limit = Math.floor(limit);
    if (limit > MAX_USHORT) {
        console.warn(`A rate limit above ${MAX_USHORT} is considered infinite`);
        return 0;
    }

    return limit;
}

export type SonicServerSettings = {
    /** Checks for protocol updates when enabled. Defaults to true. */
    readonly checkForUpdates?: boolean;
    /** If the rereference should use a 64 bit hash which is less prone to collision (1% after ~600 million) or a 32 bit hash. Defaults to true. */
    readonly bit64Hash?: boolean;
    /** Serves browser assets from `/SonicWS` when enabled. Defaults to true. */
    readonly serveBrowserClient?: boolean;
    /** Limits a required application handshake. Defaults to 10 seconds. */
    readonly handshakeTimeoutMs?: number;
    /** Enables portable CONTROL heartbeats. Defaults to true. */
    readonly heartbeat?: boolean;
    /** Controls the heartbeat interval. Zero disables it. */
    readonly heartbeatIntervalMs?: number;
    /** Limits how long the server waits for any reply before terminating. */
    readonly heartbeatTimeoutMs?: number;
};

/**
 * Configures a SonicWS server.
 */
export type SonicServerOptions = {
    /** Declares packets accepted from clients. */
    readonly clientPackets?: PacketTypings,
    /** Declares packets sent to clients. */
    readonly serverPackets?: PacketTypings,
    /** Forwards options to the underlying `ws` server. */
    readonly websocketOptions?: WS.ServerOptions;
    readonly sonicServerSettings?: SonicServerSettings;
    readonly onSendError?: (
        error: unknown,
        context: {
            packetTag: string;
            connection?: SonicWSConnection;
            operation?: "broadcast";
        },
    ) => void;
    /** Optional cross-process adapter used for room membership and room broadcasts. */
    readonly adapter?: SonicWSAdapter;
    /** Bounded replay storage used by reconnecting clients. */
    readonly recovery?: {
        maxDisconnectionMs?: number;
        maxPackets?: number;
        authorize?: (
            previousState: Record<string, unknown>,
            currentState: Record<string, unknown>,
            connection: SonicWSConnection,
        ) => boolean | Promise<boolean>;
    };
}

type RecoverySession = {
    state: Record<string, unknown>;
    rooms: Set<string>;
    sequence: number;
    frames: Array<{ sequence: number; data: Uint8Array }>;
    expiresAt: number;
};

export type PacketTypings = readonly Packet<PacketType | readonly PacketType[]>[];

export class SonicWSServer extends MiddlewareHolder<ServerMiddleware> {
    private wss: WS.WebSocketServer;

    private availableIds: number[] = [];
    private lastId: number = 0;
    
    private connectListeners: Array<(client: SonicWSConnection) => void> = [];
    private recoveredListeners: Array<(client: SonicWSConnection, replayed: number) => void | Promise<void>> = [];

    public clientPackets: PacketHolder;
    public serverPackets: PacketHolder;

    connections: SonicWSConnection[] = [];
    connectionMap: Record<number, SonicWSConnection> = {};

    private clientRateLimit: number = 500;
    private serverRateLimit: number = 500;

    private handshakePacket: string | null = null;

    tags: Map<SonicWSConnection, Set<string>> = new Map();
    tagsInv: Map<string, Set<SonicWSConnection>> = new Map();

    private serverwideSendQueue: SendQueue = [false, [], undefined];
    private readonly sendErrorHandler?: SonicServerOptions["onSendError"];
    private readonly adapter?: SonicWSAdapter;
    private readonly serverId = randomUUID();
    private readonly sessions = new Map<string, RecoverySession>();
    private readonly recoveryMaxDisconnectionMs: number;
    private readonly recoveryMaxPackets: number;
    private readonly recoveryAuthorize?: NonNullable<SonicServerOptions["recovery"]>["authorize"];

    /**
     * Initializes and hosts a websocket with sonic protocol
     * Rate limits can be set with wss.setClientRateLimit(x) and wss.setServerRateLimit(x); it is defaulted at 500/second per both
     * @param settings Sonic Server Options such as schema data for client and server packets, alongside websocket options
     */ 
    constructor(settings: SonicServerOptions) {
        super();

        const { clientPackets = [], serverPackets = [], websocketOptions = {} } = settings;
        this.sendErrorHandler = settings.onSendError;
        this.adapter = settings.adapter;
        this.recoveryMaxDisconnectionMs = settings.recovery?.maxDisconnectionMs ?? 120_000;
        this.recoveryMaxPackets = settings.recovery?.maxPackets ?? 1_000;
        this.recoveryAuthorize = settings.recovery?.authorize;
        if (!Number.isFinite(this.recoveryMaxDisconnectionMs) || this.recoveryMaxDisconnectionMs < 0) {
            throw new Error("recovery.maxDisconnectionMs must be a non-negative finite number");
        }
        if (!Number.isInteger(this.recoveryMaxPackets) || this.recoveryMaxPackets < 0) {
            throw new Error("recovery.maxPackets must be a non-negative integer");
        }

        const handshakeTimeout = settings.sonicServerSettings?.handshakeTimeoutMs ?? 10_000;
        const heartbeatInterval = (settings.sonicServerSettings?.heartbeat ?? true)
            ? settings.sonicServerSettings?.heartbeatIntervalMs ?? 30_000
            : 0;
        const heartbeatTimeout = settings.sonicServerSettings?.heartbeatTimeoutMs ?? 10_000;

        if (!Number.isFinite(handshakeTimeout) || handshakeTimeout <= 0) {
            throw new Error("handshakeTimeoutMs must be positive");
        }
        if (
            !Number.isFinite(heartbeatInterval)
            || heartbeatInterval < 0
            || !Number.isFinite(heartbeatTimeout)
            || heartbeatTimeout <= 0
        ) {
            throw new Error("Invalid heartbeat timing options");
        }
 
        this.wss = new WS.WebSocketServer({ maxPayload: 8 * 1024 * 1024, ...websocketOptions });

        if (settings.sonicServerSettings?.serveBrowserClient ?? true) {
            const httpServer = websocketOptions.server ?? (this.wss as unknown as { _server?: HTTPServer })._server;
            if (httpServer) {
                this.installBrowserAssetRoutes(httpServer);
            }
        }

        this.clientPackets = new PacketHolder(clientPackets);
        this.serverPackets = new PacketHolder(serverPackets);

        Promise.resolve(this.adapter?.start?.(this.serverId, message => this.receiveAdapterBroadcast(message)))
            .catch(error => this.handleSendError(error, { packetTag: "<adapter>", operation: "broadcast" }));

        const serializedClientPackets = this.clientPackets.serialize();
        const serializedServerPackets = this.serverPackets.serialize();

        const serverData = [...SERVER_SUFFIX_NUMS, VERSION];
        const keyData: number[] = [
            ...convertVarInt(serializedClientPackets.length),
            ...serializedClientPackets,
            ...serializedServerPackets,
        ];

        setHashFunc(settings.sonicServerSettings?.bit64Hash ?? true);

        this.wss.on('connection', async (socket, request) => {
            const heartbeatIntervalMs = (settings.sonicServerSettings?.heartbeat ?? true)
                ? settings.sonicServerSettings?.heartbeatIntervalMs ?? 30_000
                : 0;
            const heartbeatTimeoutMs = settings.sonicServerSettings?.heartbeatTimeoutMs ?? 10_000;
            let heartbeatTimeout: ReturnType<typeof setTimeout> | undefined;
            let heartbeat: ReturnType<typeof setInterval> | undefined;
            let lastActivity = Date.now();

            // every inbound frame proves that the peer is alive
            socket.on("message", () => {
                lastActivity = Date.now();
                if (heartbeatTimeout) clearTimeout(heartbeatTimeout);
                heartbeatTimeout = undefined;
            });

            const sessionId = randomUUID();
            const session: RecoverySession = {
                state: {},
                rooms: new Set(),
                sequence: 0,
                frames: [],
                expiresAt: Infinity,
            };
            this.sessions.set(sessionId, session);

            const sonicConnection = new SonicWSConnection(
                socket,
                this,
                this.generateSocketID(),
                this.handshakePacket,
                this.clientRateLimit,
                this.serverRateLimit,
                sessionId,
                session.state,
                settings.sonicServerSettings?.handshakeTimeoutMs ?? 10_000,
                request,
            );

            if (heartbeatIntervalMs > 0) {
                heartbeat = setInterval(() => {
                    if (socket.readyState !== WS.WebSocket.OPEN) return;
                    if (Date.now() - lastActivity < heartbeatIntervalMs) return;

                    socket.send(Uint8Array.of(0));
                    const sentAt = Date.now();
                    heartbeatTimeout = setTimeout(() => {
                        if (lastActivity >= sentAt) return;

                        socket.close(CloseCodes.HEARTBEAT_TIMEOUT, "Heartbeat timeout");
                        const forceClose = setTimeout(() => socket.terminate(), 250);
                        forceClose.unref?.();
                    }, heartbeatTimeoutMs);
                    heartbeatTimeout.unref?.();
                }, heartbeatIntervalMs);
                heartbeat.unref?.();
            }

            if (await this.callMiddleware("onClientConnect", sonicConnection)) {
                const reason = "Connection blocked by middleware";
                sonicConnection.close(CloseCodes.MIDDLEWARE, reason);
                this.callMiddleware(
                    "onClientDisconnect",
                    sonicConnection,
                    CloseCodes.MIDDLEWARE,
                    Buffer.from(reason),
                );
                this.availableIds.push(sonicConnection.id);
                this.sessions.delete(sessionId);
                return;
            }

            // send packet definitions so the client does not hard-code numeric keys
            const encodedSession = new TextEncoder().encode(sessionId);
            const data = new Uint8Array([
                ...convertVarInt(sonicConnection.id),
                ...convertVarInt(encodedSession.length),
                ...encodedSession,
                ...keyData,
            ]);
            socket.send([...serverData, ...deflateNative(data)]);

            this.connections.push(sonicConnection);
            this.connectionMap[sonicConnection.id] = sonicConnection;
            this.connectListeners.forEach(listener => listener(sonicConnection));

            socket.on('close', (code, reason) => {
                if (heartbeat) clearInterval(heartbeat);
                if (heartbeatTimeout) clearTimeout(heartbeatTimeout);

                const previousRooms = new Set(this.tags.get(sonicConnection) ?? []);
                this.connections.splice(this.connections.indexOf(sonicConnection), 1);
                delete this.connectionMap[sonicConnection.id];
                this.availableIds.push(sonicConnection.id);

                if (this.tags.has(sonicConnection)) {
                    for (const tag of this.tags.get(sonicConnection)!) {
                        this.tagsInv.get(tag)?.delete(sonicConnection);
                    }
                    this.tags.delete(sonicConnection);
                }

                Promise.resolve(this.adapter?.disconnect(sonicConnection.id)).catch(error =>
                    this.handleSendError(error, { packetTag: "<adapter>", connection: sonicConnection }));

                const recovery = this.sessions.get(sonicConnection.sessionId);
                if (recovery) {
                    recovery.rooms = previousRooms;
                    recovery.expiresAt = Date.now() + this.recoveryMaxDisconnectionMs;
                    const expiryTimer = setTimeout(() => {
                        const current = this.sessions.get(sonicConnection.sessionId);
                        if (current === recovery && current.expiresAt <= Date.now()) {
                            this.sessions.delete(sonicConnection.sessionId);
                        }
                    }, this.recoveryMaxDisconnectionMs + 1);
                    expiryTimer.unref?.();
                }

                this.callMiddleware("onClientDisconnect", sonicConnection, code, reason);
            });
        });

        if (settings.sonicServerSettings?.checkForUpdates ?? true) {
            fetch('https://raw.githubusercontent.com/liwybloc/sonic-ws/refs/heads/main/release/version')
                .then((response: Response) => response.text())
                .then((version: string) => {
                    if (parseInt(version) > VERSION) {
                        console.warn(
                            `SonicWS protocol ${VERSION} is outdated, latest is ${version}. `
                            + 'Update with "npm update sonic-ws"',
                        );
                    }
                })
                .catch((error: Error) => {
                    console.error(error);
                    console.warn("Could not check the SonicWS protocol version");
                });
        }
    }

    private installBrowserAssetRoutes(server: HTTPServer): void {
        const existingListeners = server.listeners('request');
        server.removeAllListeners('request');

        server.on('request', (request: IncomingMessage, response: ServerResponse) => {
            const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
            const asset = pathname === '/SonicWS/bundle.js'
                ? ['bundle.js', 'text/javascript; charset=utf-8'] as const
                : pathname === '/SonicWS/bundle.wasm'
                    ? ['bundle.wasm', 'application/wasm'] as const
                    : undefined;

            if (!asset) {
                for (const listener of existingListeners)
                    Reflect.apply(listener, server, [request, response]);
                return;
            }

            const filename = resolve(__dirname, '../../../bundled', asset[0]);
            readFile(filename).then(data => {
                response.writeHead(200, {
                    'content-type': asset[1],
                    'content-length': data.byteLength,
                    'cache-control': 'public, max-age=3600',
                });
                response.end(data);
            }).catch(error => {
                response.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
                response.end(`Unable to load SonicWS browser asset: ${error instanceof Error ? error.message : String(error)}`);
            });
        });
    }

    private generateSocketID(): number {
        if (this.availableIds.length === 0) {
            this.availableIds.push(this.lastId + 1);
        }

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
    public requireHandshake(packet: string): void {
        if (!this.clientPackets.hasTag(packet)) {
            throw new Error(`The client does not define "${packet}" so it cannot be used as a handshake`);
        }
        if (this.clientPackets.getPacket(packet).dataBatching !== 0) {
            throw new Error(`The batched packet "${packet}" cannot be used as a handshake`);
        }

        this.handshakePacket = packet;
    }

    /**
     * Sets the rate limit for all client-side packets
     * @param limit Amount of packets the sockets can send every second, or 0 for infinite
     */
    public setClientRateLimit(limit: number): void {
        this.clientRateLimit = normalizeRateLimit(limit);
    }

    /**
     * Sets the rate limit for server-side packets per-socket
     * @param limit Amount of packets the server can send every second, or 0 for infinite
     */
    public setServerRateLimit(limit: number): void {
        this.serverRateLimit = normalizeRateLimit(limit);
    }

    /**
     * Enables a packet for all current & new clients.
     * @param tag The tag of the packet
     */
    public enablePacket(tag: string): void {
        this.clientPackets.getPacket(tag).defaultEnabled = true;
        this.connections.forEach(socket => socket.enablePacket(tag));
    }

    /**
     * Disables a packet for all current & new clients.
     * @param tag The tag of the packet
     */
    public disablePacket(tag: string): void {
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

    /** Runs after a reconnecting client has restored its state and rooms. */
    public on_recovered(runner: (client: SonicWSConnection, replayed: number) => void | Promise<void>): void {
        this.recoveredListeners.push(runner);
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
        this.sessions.clear();
        Promise.resolve(this.adapter?.close?.()).catch(error =>
            this.handleSendError(error, { packetTag: "<adapter>", operation: "broadcast" }));
        this.wss.close(callback);
    }

    private async receiveAdapterBroadcast(message: AdapterBroadcast): Promise<void> {
        if (message.origin === this.serverId) return;
        await this.broadcastInternal(message.packetTag, {
            type: "filter",
            filter: socket => this.tags.get(socket)?.has(message.room) === true
                && socket.id !== message.exceptConnectionId,
        }, message.values);
    }

    /** Wraps and stores an opted-in packet for bounded replay. */
    public replayFrame(connection: SonicWSConnection, packetFrame: Uint8Array): Uint8Array {
        const session = this.sessions.get(connection.sessionId);
        if (!session) return packetFrame;

        const sequence = ++session.sequence;
        const replay = encodeReplay(sequence, packetFrame);
        session.frames.push({ sequence, data: replay });

        if (session.frames.length > this.recoveryMaxPackets) {
            session.frames.splice(0, session.frames.length - this.recoveryMaxPackets);
        }

        return replay;
    }

    /** Restores state, rooms, and missed replayable packets onto a replacement connection. */
    public async resumeSession(connection: SonicWSConnection, sessionId: string, lastSequence: number): Promise<void> {
        const session = this.sessions.get(sessionId);
        if (!session || session.expiresAt < Date.now()) {
            connection.raw_send(encodeResumed(false, 0));
            return;
        }
        const authorized = this.recoveryAuthorize
            ? await this.recoveryAuthorize(session.state, connection.state, connection)
            : session.state.userId === undefined || session.state.userId === connection.state.userId;

        if (!authorized) {
            connection.raw_send(encodeResumed(false, 0));
            return;
        }
        this.sessions.delete(connection.sessionId);
        connection.sessionId = sessionId;
        connection.state = session.state;
        session.expiresAt = Infinity;
        this.sessions.set(sessionId, session);

        for (const room of session.rooms) {
            this.join(connection, room);
        }

        const frames = session.frames.filter(frame => frame.sequence > lastSequence);
        for (const frame of frames) {
            connection.raw_send(frame.data);
        }

        connection.raw_send(encodeResumed(true, frames.length));
        for (const listener of this.recoveredListeners) {
            await listener(connection, frames.length);
        }
    }

    private async broadcastInternal(
        packetTag: string,
        target:
            | { type: "all" }
            | { type: "tagged"; tag: string }
            | { type: "filter"; filter: (socket: SonicWSConnection) => boolean },
        values: any[],
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

        if (await this.callMiddleware("onPacketBroadcast_pre", packetTag, { recipients, ...target }, values)) return;

        if (recipients.length === 0) return;

        const [code, data, packet] = await processPacket(
            this.serverPackets,
            packetTag,
            values,
            this.serverwideSendQueue,
            -1,
        );

        if (await this.callMiddleware(
            "onPacketBroadcast_post",
            packetTag,
            { recipients, ...target },
            data,
            data.length,
        )) return;

        recipients.forEach(connection => connection.send_processed(code, data, packet));
    }

    public async broadcastTagged(tag: string, packetTag: string, ...values: any): Promise<void> {
        await this.broadcastInternal(packetTag, { type: "tagged", tag }, values);
    }

    /** Sends a packet to every local and adapter-connected room member. */
    public async broadcastRoom(room: string, packetTag: string, ...values: any[]): Promise<void> {
        await this.broadcastInternal(packetTag, { type: "tagged", tag: room }, values);
        await this.adapter?.publish({ origin: this.serverId, room, packetTag, values });
    }

    /** Sends a room packet except to one connection. */
    public async broadcastRoomExcept(
        connection: SonicWSConnection,
        room: string,
        packetTag: string,
        ...values: any[]
    ): Promise<void> {
        await this.broadcastInternal(packetTag, {
            type: "filter",
            filter: socket => socket !== connection && this.tags.get(socket)?.has(room) === true,
        }, values);
        await this.adapter?.publish({
            origin: this.serverId,
            room,
            packetTag,
            values,
            exceptConnectionId: connection.id,
        });
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

    public async broadcastSafe(tag: string, ...values: any[]): Promise<boolean> {
        try {
            await this.broadcast(tag, ...values);
            return true;
        } catch (error) {
            this.handleSendError(error, { packetTag: tag, operation: "broadcast" });
            return false;
        }
    }

    public broadcastVariant(parent: string, variant: string, ...values: any[]): Promise<void> {
        return this.broadcast(this.serverPackets.getVariantTag(parent, variant), ...values);
    }

    public broadcastPermutation(
        parent: string,
        selection: readonly boolean[] | Record<string, boolean>,
        ...values: any[]
    ): Promise<void> {
        return this.broadcast(this.serverPackets.getPermutationVariant(parent, selection), ...values);
    }

    public handleSendError(
        error: unknown,
        context: { packetTag: string; connection?: SonicWSConnection; operation?: "broadcast" },
    ): void {
        if (this.sendErrorHandler) this.sendErrorHandler(error, context);
        else console.error(`Failed to send packet "${context.packetTag}"`, error);
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
    public tag(socket: SonicWSConnection, tag: string, replace: boolean = true): void {
        if (!this.tags.has(socket)) this.tags.set(socket, new Set());
        if (!this.tagsInv.has(tag)) this.tagsInv.set(tag, new Set());

        if (replace) {
            this.tags.get(socket)!.forEach(existingTag => {
                this.tagsInv.get(existingTag)?.delete(socket);
                Promise.resolve(this.adapter?.leave(socket.id, existingTag)).catch(error =>
                    this.handleSendError(error, { packetTag: "<adapter>", connection: socket }));
            });
            this.tags.get(socket)!.clear();
        }

        this.tags.get(socket)!.add(tag);
        this.tagsInv.get(tag)!.add(socket);
        Promise.resolve(this.adapter?.join(socket.id, tag)).catch(error =>
            this.handleSendError(error, { packetTag: "<adapter>", connection: socket }));
    }

    /** Adds a connection to a server-side room without removing its other rooms. */
    public join(socket: SonicWSConnection, room: string): void {
        if (!room) throw new Error("Room name cannot be empty");
        this.tag(socket, room, false);
    }

    /** Removes a connection from a server-side room. */
    public leave(socket: SonicWSConnection, room: string): void {
        this.tags.get(socket)?.delete(room);
        const members = this.tagsInv.get(room);
        members?.delete(socket);
        if (members?.size === 0) this.tagsInv.delete(room);
        Promise.resolve(this.adapter?.leave(socket.id, room)).catch(error =>
            this.handleSendError(error, { packetTag: "<adapter>", connection: socket }));
    }

    public rooms(socket: SonicWSConnection): ReadonlySet<string> {
        return this.tags.get(socket) ?? new Set();
    }

    private debugServer: DebugServer | null = null;

    /**
     * Opens a debug menu; this launches the browser and starts a subserver
     * @param port Port of the server/http, defaults to 0 which finds an open port
     * @param password Toggles the requirement of a password to access the server. Defaults to empty, which doesn't ask for a password.
     */
    public OpenDebug(data: { port?: number; password?: string } = {}): void {
        if (this.debugServer != null) {
            throw new Error("A debug server is already running");
        }

        this.debugServer = new DebugServer(this, data);
    }

}
