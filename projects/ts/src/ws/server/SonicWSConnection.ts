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
import type { IncomingMessage } from 'node:http';
import { SonicWSServer } from "./SonicWSServer";
import { listenPacket, processPacket } from "../util/packets/PacketUtils";
import { BatchHelper } from "../util/packets/BatchHelper";
import { Packet } from "../packets/Packets";
import { RateHandler } from "../util/packets/RateHandler";
import { stringifyBuffer, toPacketBuffer } from "../util/BufferUtil";
import { CloseCodes, Connection } from "../Connection";
import { AsyncPQ, PacketQueue, SendQueue, ServerPQ } from "../PacketProcessor";
import {
    ControlType,
    decodeControl,
    encodeControlRequest,
    encodeControlResponse,
} from "../util/packets/ControlProtocol";

const CLIENT_RATELIMIT_TAG = "C";
const SERVER_RATELIMIT_TAG = "S";

export class SonicWSConnection extends Connection<WS.WebSocket, Buffer> {

    private host: SonicWSServer;

    private print: boolean = false;
    
    private handshakePacket: string | null;
    private handshakeLambda!: (data: WS.MessageEvent) => void;

    private messageLambda = (data: WS.MessageEvent) => this.routeMessage(data);
    private handshakedMessageLambda = (data: WS.MessageEvent) => {
        if (this.isControl(data)) return void this.handleControl(new Uint8Array(data.data as Buffer));
        const parsed = this.parseData(data);
        if (parsed == null) return this.socket.close(CloseCodes.INVALID_DATA);
        if (parsed[0] === this.handshakePacket) return this.socket.close(CloseCodes.REPEATED_HANDSHAKE);
        void this.messageHandler(parsed);
    };

    private rater: RateHandler<this>;

    private enabledPackets: Record<string, boolean> = {};

    /** If the packet handshake has been completed; `wss.requireHandshake(packet)` */
    public handshakeComplete: boolean = false;

    private asyncMap: Record<string, boolean> = {};
    private asyncData: Record<string, [boolean, PacketQueue<ServerPQ>]> = {};
    private nextRequestId = 1;
    private pendingRequests = new Map<number, {
        resolve: (value: any) => void;
        reject: (error: Error) => void;
        timer: ReturnType<typeof setTimeout>;
    }>();
    private responders = new Map<string, (...values: any[]) => any>();
    public sessionId: string;
    /** Provides the HTTP upgrade request for authentication headers and cookies. */
    public readonly upgradeRequest: IncomingMessage;

    constructor(
        socket: WS.WebSocket,
        host: SonicWSServer,
        id: number,
        handshakePacket: string | null,
        clientRateLimit: number,
        serverRateLimit: number,
        sessionId: string,
        state: Record<string, unknown>,
        handshakeTimeoutMs: number,
        upgradeRequest: IncomingMessage,
    ) {
        super(
            socket,
            id,
            `Socket ${id}`,
            socket.addEventListener.bind(socket),
            socket.removeEventListener.bind(socket),
        );

        this.host = host;
        this.sessionId = sessionId;
        this.upgradeRequest = upgradeRequest;
        this.state = state;
        
        this.handshakePacket = handshakePacket;

        for (const packet of host.clientPackets.getPackets()) {
            const tag = packet.tag;
            this.listeners[tag] = [];
            packet.lastReceived[this.id] = undefined;
            this.enabledPackets[tag] = packet.defaultEnabled;
            this.asyncMap[tag] = packet.async;

            if (packet.async) {
                this.asyncData[tag] = [false, []];
            }
        }

        this.setInterval = this.setInterval.bind(this);

        this.batcher.registerSendPackets(this.host.serverPackets, this);
        this.invalidPacket = this.invalidPacket.bind(this);

        this.rater = new RateHandler(this);

        this.rater.registerRate(CLIENT_RATELIMIT_TAG, clientRateLimit);
        this.rater.registerRate(SERVER_RATELIMIT_TAG, serverRateLimit);

        this.rater.registerAll(host.clientPackets, "client");
        this.rater.registerAll(host.serverPackets, "server");

        this.rater.start();

        if (this.handshakePacket == null) {
            this.socket.addEventListener('message', this.messageLambda);
        } else {
            this.handshakeLambda = (data: WS.MessageEvent) => this.handshakeHandler(data);
            this.socket.addEventListener('message', this.handshakeLambda);
            this.setTimeout(() => {
                if (!this.handshakeComplete) {
                    this.close(CloseCodes.INVALID_DATA, "Application handshake timed out");
                }
            }, handshakeTimeoutMs);
        }

        this.socket.on('close', () => {
            for (const packet of host.clientPackets.getPackets()) {
                delete packet.lastReceived[this.id];
            }
            for (const packet of host.serverPackets.getPackets()) {
                delete packet.lastSent[this.id];
                packet.clearQuantizationState(this.id);
            }
        });
    }

    private parseData(event: WS.MessageEvent): [key: string, value: Uint8Array] | null {
        if (this.rater.trigger(CLIENT_RATELIMIT_TAG)) return null;
        if (!(event.data instanceof Buffer)) return null;

        const message = new Uint8Array(event.data);

        if (this.print) {
            console.log(
                `\x1b[31m⬇ \x1b[38;5;245m(${this.id},${message.byteLength})\x1b[0m`,
                (message.length > 0 && this.host.clientPackets.getTag(message[0])) || "<INVALID>",
                stringifyBuffer(message),
            );
        }

        if (message.byteLength < 1) {
            this.socket.close(CloseCodes.SMALL);
            return null;
        }

        const key = message[0];
        const value = message.slice(1);

        // reject keys that were not negotiated during the schema handshake
        if (!this.host.clientPackets.hasKey(key)) {
            this.socket.close(CloseCodes.INVALID_KEY);
            return null;
        }

        const tag = this.host.clientPackets.getTag(key)!;

        // reject packets disabled for this connection
        if (!this.enabledPackets[tag]) {
            this.socket.close(CloseCodes.DISABLED_PACKET);
            return null;
        }

        if (this.rater.trigger(`client${key}`)) return null;

        return [tag, value];
    }

    private isControl(event: WS.MessageEvent): boolean {
        return event.data instanceof Buffer && event.data.length > 0 && event.data[0] === 0;
    }

    private routeMessage(event: WS.MessageEvent): void {
        if (this.isControl(event)) {
            void this.handleControl(new Uint8Array(event.data as Buffer));
        } else {
            void this.messageHandler(this.parseData(event));
        }
    }

    private async handleControl(data: Uint8Array): Promise<void> {
        // a single CONTROL key is an acknowledgement to a server heartbeat
        if (data.length === 1) return;

        if (this.rater.trigger(CLIENT_RATELIMIT_TAG)) return;

        let message;
        try {
            message = decodeControl(data);
        } catch {
            this.close(CloseCodes.INVALID_DATA, "Malformed SonicWS control frame");
            return;
        }

        if (message.type === ControlType.HEARTBEAT) return;

        if (message.type === ControlType.RESUME) {
            await this.host.resumeSession(this, message.sessionId, message.lastSequence);
            return;
        }
        if (!this.handshakeComplete && this.handshakePacket !== null) {
            this.close(CloseCodes.INVALID_DATA, "Handshake required before control requests");
            return;
        }
        if (message.type === ControlType.REPLAY || message.type === ControlType.RESUMED) {
            throw new Error("A server cannot receive replay delivery frames");
        }

        if (message.type === ControlType.RESPONSE) {
            const pending = this.pendingRequests.get(message.id);
            if (!pending) return;

            clearTimeout(pending.timer);
            this.pendingRequests.delete(message.id);

            if (message.ok) {
                pending.resolve(message.value);
            } else {
                pending.reject(new Error(String(message.value)));
            }
            return;
        }

        try {
            const tag = this.host.clientPackets.getTag(message.packetKey);
            if (!tag) throw new Error(`Unknown RPC packet key ${message.packetKey}`);
            if (!this.enabledPackets[tag]) {
                return this.close(CloseCodes.DISABLED_PACKET, `Packet "${tag}" is disabled`);
            }
            if (this.rater.trigger(`client${message.packetKey}`)) {
                return this.close(CloseCodes.RATELIMIT, `Packet "${tag}" exceeded its rate limit`);
            }
            if (await this.callMiddleware('onReceive_pre', tag, message.payload, message.payload.length)) {
                throw new Error(`Packet "${tag}" was rejected by middleware`);
            }

            const responder = this.responders.get(tag);
            if (!responder) throw new Error(`No responder registered for packet "${tag}"`);

            const decoded = await this.host.clientPackets.getPacket(tag).listen(message.payload, this);
            if (typeof decoded === "string") throw new Error(decoded);

            const [payload, spread] = decoded;
            const result = spread ? await responder(...payload) : await responder(payload);
            this.raw_send(encodeControlResponse(message.id, true, result ?? null));
        } catch (error) {
            this.raw_send(encodeControlResponse(
                message.id,
                false,
                error instanceof Error ? error.message : String(error),
            ));
        }
    }


    private handshakeHandler(data: WS.MessageEvent): void {
        if (this.isControl(data)) {
            void this.handleControl(new Uint8Array(data.data as Buffer));
            return;
        }
        const parsed = this.parseData(data);
        if (parsed == null) return this.socket.close(CloseCodes.INVALID_DATA);

        if (parsed[0] !== this.handshakePacket) {
            this.socket.close(CloseCodes.INVALID_DATA);
            return;
        }

        void this.messageHandler(parsed);

        this.socket.removeEventListener('message', this.handshakeLambda);
        this.socket.addEventListener('message', this.handshakedMessageLambda);

        this.handshakeComplete = true;
    }

    private invalidPacket(listened: string): void {
        console.warn("Closing connection after an invalid packet", listened);
        this.socket.close(CloseCodes.INVALID_PACKET, listened);
    }
    
    private isAsync(tag: string): boolean {
        return this.asyncMap[tag];
    }

    private listenLock: boolean = false;
    private packetQueue: PacketQueue<ServerPQ> = [];

    private async deliverPacket(
        data: string | [any[], boolean],
        tag: string,
        packetQueue: PacketQueue<ServerPQ>,
        isAsync: boolean,
        asyncData?: AsyncPQ<ServerPQ>,
    ): Promise<void> {
        if (this.closed) return;

        await listenPacket(data, this.listeners[tag], this.invalidPacket);

        const packet = this.host.clientPackets.getPacket(tag);
        if (typeof data !== "string" && packet.parent && packet.variant) {
            for (const listener of this.listeners[packet.parent] ?? []) {
                const permutation = packet.permutation();
                await listener({ variant: packet.variant, payload: data[0], ...(permutation && { permutation }) });
            }
        }

        await this.callMiddleware('onReceive_post', tag, typeof data === "string" ? [data] : data[0]);
        this.releasePacketLock(packetQueue, isAsync, asyncData);
    }

    private releasePacketLock(
        packetQueue: PacketQueue<ServerPQ>,
        isAsync: boolean,
        asyncData?: AsyncPQ<ServerPQ>,
    ): void {
        if (isAsync) {
            asyncData![0] = false;
        } else {
            this.listenLock = false;
        }

        if (packetQueue.length > 0) {
            void this.messageHandler(packetQueue.shift()!);
        }
    }

    private async messageHandler(data: [tag: string, value: Uint8Array] | null, recall: boolean = false): Promise<void> {
        if (data == null) return;

        const [tag, value] = data;

        const isAsync = this.isAsync(tag);

        let locked: boolean;
        let packetQueue: PacketQueue<ServerPQ>;
        let asyncData: AsyncPQ<ServerPQ> | undefined;

        if (isAsync) {
            asyncData = this.asyncData[tag];
            locked = asyncData[0];
            packetQueue = asyncData[1];
        } else {
            locked = this.listenLock;
            packetQueue = this.packetQueue;
        }

        if (locked) {
            packetQueue!.push(data);
            return;
        }

        if (isAsync) {
            asyncData![0] = true;
        } else {
            this.listenLock = true;
        }

        const packet = this.host.clientPackets.getPacket(tag);
        if (!recall && await this.callMiddleware('onReceive_pre', packet.tag, value, value.length)) {
            this.releasePacketLock(packetQueue, isAsync, asyncData);
            return;
        }

        if (packet.rereference && value.length === 0) {
            const lastRecv = packet.lastReceived[this.id];
            if (lastRecv === undefined) {
                this.invalidPacket("No previous value to rereference");
                return;
            }

            await this.deliverPacket(lastRecv as any, tag, packetQueue, isAsync, asyncData);
            return;
        }

        if (packet.dataBatching === 0) {
            const result = await packet.listen(value, this);
            packet.lastReceived[this.id] = result;
            await this.deliverPacket(result, tag, packetQueue, isAsync, asyncData);
            return;
        }

        const batchData = await BatchHelper.unravelBatch(packet, value, this);
        if (typeof batchData === "string") {
            this.invalidPacket(batchData);
            return;
        }

        for (const result of batchData) {
            if (isAsync) {
                asyncData![0] = true;
            } else {
                this.listenLock = true;
            }

            await this.deliverPacket(result, tag, packetQueue, isAsync, asyncData);
        }
    }

    /**
     * Enables a packet for the client.
     * @param tag The tag of the packet
     */
    public enablePacket(tag: string): void {
        this.enabledPackets[tag] = true;
    }
    /**
     * Disables a packet for the client.
     * @param tag The tag of the packet
     */
    public disablePacket(tag: string): void {
        this.enabledPackets[tag] = false;
    }

    /**
     * Listens for when the connection closes
     * @param listener Called when it closes
     */
    public on_close(listener: (code: number, reason: string) => void): void {
        this.socket.on('close', (code, reason) => listener(code, String(reason)));
    }

    /**
     * Listens for a packet
     * @param tag The tag of the key to listen for
     * @param listener A function to listen for it 
     */
    public on(tag: string, listener: (...values: any) => void): void {
        if (!this.host.clientPackets.hasTag(tag)) {
            throw new Error(`Packet tag "${tag}" has not been created`);
        }

        const resolved = this.host.clientPackets.resolveTag(tag);
        this.listeners[resolved] ??= [];
        this.listeners[resolved].push(listener);
    }

    /**
     * For internal use.
     */
    public send_processed(code: number, data: Uint8Array, packet: Packet<any>): void {
        if (this.rater.trigger(`server${code}`)) return;

        if (packet.dataBatching === 0) {
            const frame = toPacketBuffer(code, data);
            this.raw_send(packet.replay ? this.host.replayFrame(this, frame) : frame);
        } else {
            this.batcher.batchPacket(code, data);
        }
    }

    private sendQueue: SendQueue = [false, [], undefined];

    /**
     * Sends a packet with the tag and values
     * @param tag The tag to send
     * @param values The values to send
     */
    public async send(tag: string, ...values: any[]): Promise<void> {
        if (await this.callMiddleware('onSend_pre', tag, values, Date.now(), performance.now())) return;

        const [code, data, packet] = await processPacket(this.host.serverPackets, tag, values, this.sendQueue, this.id);
        if (await this.callMiddleware('onSend_post', tag, data, data.length)) return;

        this.send_processed(code, data, packet);
    }

    public sendVariant(parent: string, variant: string, ...values: any[]): Promise<void> {
        return this.send(this.host.serverPackets.getVariantTag(parent, variant), ...values);
    }

    public sendPermutation(
        parent: string,
        selection: readonly boolean[] | Record<string, boolean>,
        ...values: any[]
    ): Promise<void> {
        return this.send(this.host.serverPackets.getPermutationVariant(parent, selection), ...values);
    }

    /** Sends a validated server packet as an RPC request to this client. */
    public async request(tag: string, ...valuesAndOptions: any[]): Promise<any> {
        const possibleOptions = valuesAndOptions.at(-1);
        const options = valuesAndOptions.length > 1
            && possibleOptions
            && typeof possibleOptions === "object"
            && !Array.isArray(possibleOptions)
            && Object.keys(possibleOptions).every(key => key === "timeoutMs")
            ? valuesAndOptions.pop() as { timeoutMs?: number }
            : {};

        const [packetKey, payload] = await processPacket(
            this.host.serverPackets,
            tag,
            valuesAndOptions,
            this.sendQueue,
            this.id,
        );
        if (this.rater.trigger(`server${packetKey}`)) {
            throw new Error(`Packet "${tag}" exceeded its rate limit`);
        }

        const id = this.nextRequestId++;
        if (this.nextRequestId > 0x7fffffff) this.nextRequestId = 1;

        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pendingRequests.delete(id);
                reject(new Error(`RPC request "${tag}" timed out`));
            }, options.timeoutMs ?? 5_000);

            this.pendingRequests.set(id, { resolve, reject, timer });
            this.raw_send(encodeControlRequest(id, packetKey, payload));
        });
    }

    /** Registers the server-side responder for client requests using this packet tag. */
    public respond(tag: string, handler: (...values: any[]) => any): void {
        this.responders.set(this.host.clientPackets.resolveTag(tag), handler);
    }

    public async sendSafe(tag: string, ...values: any[]): Promise<boolean> {
        try {
            await this.send(tag, ...values);
            return true;
        } catch (error) {
            this.host.handleSendError(error, { packetTag: tag, connection: this });
            return false;
        }
    }

    /** Drops this update before encoding when the transport is backpressured. */
    public async sendVolatile(tag: string, ...values: any[]): Promise<boolean> {
        if (!this.canSendVolatile()) return false;
        await this.send(tag, ...values);
        return true;
    }

    /** Sends a packet without applying the volatile backpressure drop policy. */
    public sendReliable(tag: string, ...values: any[]): Promise<void> {
        return this.send(tag, ...values);
    }

    /**
     * Broadcasts a packet to all other users connected
     * @param tag The tag to send
     * @param values The values to send
     */
    public broadcastFiltered(
        tag: string,
        filter: (socket: SonicWSConnection) => boolean,
        ...values: any[]
    ): void {
        void this.host.broadcastFiltered(tag, socket => socket !== this && filter(socket), ...values);
    }

    /**
     * Broadcasts a packet to all other users connected
     * @param tag The tag to send
     * @param values The values to send
     */
    public broadcast(tag: string, ...values: any[]): void {
        this.broadcastFiltered(tag, () => true, ...values);
    }

    /** Adds this connection to a server-side room. */
    public join(room: string): void {
        this.host.join(this, room);
    }

    /** Removes this connection from a server-side room. */
    public leave(room: string): void {
        this.host.leave(this, room);
    }

    /** Returns the server-side rooms currently assigned to this connection. */
    public getRooms(): ReadonlySet<string> {
        return this.host.rooms(this);
    }

    public broadcastRoom(room: string, tag: string, ...values: any[]): Promise<void> {
        return this.host.broadcastRoomExcept(this, room, tag, ...values);
    }

    /**
     * Toggles printing all sent and received messages
     */
    public togglePrint(): void {
        this.print = !this.print;
    }

    /* JSDocs in Connection.ts class */

    public raw_send(data: Uint8Array): void {
        if (this.isClosed()) {
            console.warn("Cannot send through a closed connection", this.id, stringifyBuffer(data));
            return;
        }
        if (this.rater.trigger(SERVER_RATELIMIT_TAG)) return;

        if (this.print) {
            console.log(
                `\x1b[32m⬆ \x1b[38;5;245m(${this.id},${data.byteLength})\x1b[0m`,
                (data.length > 0 && this.host.serverPackets.getTag(data[0])) || "<INVALID>",
                stringifyBuffer(data),
            );
        }

        super.raw_send(data);
    }

    /**
     * Tags the socket with a key
     * @param tag The tag to add
     * @param replace If it should replace a previous tag; defaults to true. If using false, you can add multiple tags.
     */
    public tag(tag: string, replace: boolean = true): void {
        this.host.tag(this, tag, replace);
    }

}
