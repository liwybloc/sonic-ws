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

import { PacketHolder } from "../../util/packets/PacketHolder";
import { readVarInt } from "../../util/packets/CompressionUtil";
import { inflateNative } from "../../../native/wrapper";
import { listenPacket, processPacket } from "../../util/packets/PacketUtils";
import { SERVER_SUFFIX, VERSION } from "../../../version";
import { Packet } from "../../packets/Packets";
import { BatchHelper } from "../../util/packets/BatchHelper";
import { toPacketBuffer } from "../../util/BufferUtil";
import { Connection } from "../../Connection";
import { AsyncPQ, ClientPQ, PacketQueue, SendQueue } from "../../PacketProcessor";
import { as8String } from "../../util/StringUtil";
import { ControlType, decodeControl, encodeControlRequest, encodeControlResponse, encodeResume } from "../../util/packets/ControlProtocol";

export type ReconnectOptions = {
    enabled?: boolean;
    attempts?: number;
    minDelayMs?: number;
    maxDelayMs?: number;
    jitter?: number;
};

type TransportBinding<T, K> = {
    socket: T;
    bufferHandler: (value: K) => Promise<Uint8Array>;
    on: Function;
    off: Function;
};

export abstract class SonicWSCore<T extends { readyState: number; send: (u: Uint8Array<ArrayBufferLike>) => void; close: (c: number, d: string | undefined) => void; }, K>
            extends Connection<T, K> {

    protected preListen: { [key: string]: Array<(data: any[]) => void> } | null;
    clientPackets: PacketHolder = new PacketHolder();
    serverPackets: PacketHolder = new PacketHolder();

    private pastKeys: boolean = false;
    private readyListeners: Array<() => void> | null = [];

    private bufferHandler: (val: K) => Promise<Uint8Array>;

    _timers: Record<number, [number, (closed: boolean) => void, boolean]> = {};

    private asyncData: Record<number, AsyncPQ<ClientPQ>> = {};
    private asyncMap: Record<number, boolean> = {};
    private reconnectFactory?: () => TransportBinding<T, K>;
    private reconnectOptions: Required<ReconnectOptions> = { enabled: false, attempts: Infinity, minDelayMs: 500, maxDelayMs: 10_000, jitter: .25 };
    private reconnectAttempt = 0;
    private reconnectTimer?: ReturnType<typeof setTimeout>;
    private intentionalClose = false;
    private connectedOnce = false;
    private reconnectingListeners: Array<(event: { attempt: number; delayMs: number }) => void> = [];
    private reconnectListeners: Array<() => void> = [];
    private reconnectFailedListeners: Array<() => void> = [];
    private nextRequestId = 1;
    private pendingRequests = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
    private responders = new Map<string, (...values: any[]) => any>();
    private sessionId?: string;
    private lastReplaySequence = 0;
    private recoveredListeners: Array<(event: { recovered: boolean; replayed: number }) => void> = [];
    private pendingResumeSession?: string;

    constructor(ws: T, bufferHandler: (val: K) => Promise<Uint8Array>, on: Function, off: Function) {
        super(ws, -1, "LocalSocket", on, off);

        this.socket = ws;
        this.preListen = {};

        this.invalidPacket = this.invalidPacket.bind(this);
        this.serverKeyHandler = this.serverKeyHandler.bind(this);
        this.messageHandler = this.messageHandler.bind(this);

        this.attachClientTransport();

        this.bufferHandler = bufferHandler;
    }

    protected configureReconnect(factory: () => TransportBinding<T, K>, options: ReconnectOptions = {}): void {
        this.reconnectFactory = factory;
        this.reconnectOptions = {
            enabled: options.enabled ?? true,
            attempts: options.attempts ?? Infinity,
            minDelayMs: options.minDelayMs ?? 500,
            maxDelayMs: options.maxDelayMs ?? 10_000,
            jitter: options.jitter ?? .25,
        };
        if (this.reconnectOptions.attempts < 0 || this.reconnectOptions.minDelayMs < 0 || this.reconnectOptions.maxDelayMs < this.reconnectOptions.minDelayMs)
            throw new Error("Invalid reconnect timing options");
        if (this.reconnectOptions.jitter < 0 || this.reconnectOptions.jitter > 1)
            throw new Error("Reconnect jitter must be between 0 and 1");
    }

    private attachClientTransport(): void {
        this._on('message', this.serverKeyHandler);
        this._on('close', (...args: any[]) => {
            for(const [id, callback, shouldCall] of Object.values(this._timers)) {
                this.clearTimeout(id);
                if(shouldCall) callback(true);
            }
            for(const packet of this.clientPackets.getPackets()) {
                delete packet.lastSent[0];
                packet.clearQuantizationState(0);
            }
            for(const packet of this.serverPackets.getPackets()) {
                delete packet.lastReceived[0];
            }
            const event = args[0];
            const code = typeof event === "number" ? event : event?.code;
            if (!this.intentionalClose && code !== 1000) this.scheduleReconnect();
        });
    }

    private scheduleReconnect(): void {
        if (!this.reconnectFactory || !this.reconnectOptions.enabled || this.reconnectTimer) return;
        if (this.reconnectAttempt >= this.reconnectOptions.attempts) {
            this.reconnectFailedListeners.forEach(listener => listener());
            return;
        }
        const attempt = ++this.reconnectAttempt;
        const base = Math.min(this.reconnectOptions.maxDelayMs, this.reconnectOptions.minDelayMs * 2 ** (attempt - 1));
        const spread = base * this.reconnectOptions.jitter;
        const delayMs = Math.max(0, Math.round(base - spread + Math.random() * spread * 2));
        this.reconnectingListeners.forEach(listener => listener({ attempt, delayMs }));
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = undefined;
            this.beginReconnect();
        }, delayMs);
    }

    private beginReconnect(): void {
        try {
            const binding = this.reconnectFactory!();
            this.clientPackets = new PacketHolder();
            this.serverPackets = new PacketHolder();
            this.asyncData = {};
            this.asyncMap = {};
            this.reading = false;
            this.readQueue = [];
            this.pastKeys = false;
            this.preListen = {};
            this.bufferHandler = binding.bufferHandler;
            this.batcher = new BatchHelper();
            this.replaceTransport(binding.socket, binding.on, binding.off);
            this.attachClientTransport();
        } catch {
            this.scheduleReconnect();
        }
    }

    private reading: boolean = false;
    private readQueue: K[] = [];
    private async serverKeyHandler(event: K) {
        if(this.reading) return this.readQueue.push(event);

        this.reading = true;
        const cdata: Uint8Array = await this.bufferHandler(event);

        if(cdata.length < 3 || as8String(cdata.slice(0, 3)) != SERVER_SUFFIX) {
            this.close(1000);
            throw new Error("The server requested is not a Sonic WS server.");
        }

        const version = cdata[3];
        if(version != VERSION) {
            this.close(1000);
            throw new Error(`Version mismatch: ${version > VERSION ? "client" : "server"} is outdated (server: ${version}, client: ${VERSION})`);              
        }

        const data = inflateNative(cdata.subarray(4, cdata.length));

        const previousSession = this.sessionId;
        const [ckOff,id] = readVarInt(data, 0);
        this.id = id;
        const [sessionOffset, sessionLength] = readVarInt(data, ckOff);
        this.sessionId = new TextDecoder().decode(data.slice(sessionOffset, sessionOffset + sessionLength));
        const [valuesOff,ckLength] = readVarInt(data, sessionOffset + sessionLength);
        
        const ckData = data.subarray(valuesOff, valuesOff + ckLength);
        this.clientPackets.holdPackets(Packet.deserializeAll(ckData, true));
        const skData = data.subarray(valuesOff + ckLength, data.length);
        this.serverPackets.holdPackets(Packet.deserializeAll(skData, true));

        this.batcher.registerSendPackets(this.clientPackets, this);

        for(const p of this.serverPackets.getPackets()) {
            const key = this.serverPackets.getKey(p.tag);
            this.asyncMap[key] = p.async;
            if(p.async) {
                this.asyncData[key] = [false, []];
            }
        }

        Object.keys(this.preListen ?? {}).forEach(tag => this.preListen![tag].forEach(listener => {
            // print the error to console without halting execution
            if(!this.serverPackets.hasTag(tag)) return console.error(new Error(`The server does not send the packet with tag "${tag}"!`));
            this.listen(tag, listener);
        }));
        this.preListen = null; // clear

        this.pastKeys = true;

        if (this.connectedOnce) {
            this.reconnectAttempt = 0;
            this.reconnectListeners.forEach(listener => listener());
        }
        this.connectedOnce = true;

        this.readyListeners?.forEach(l => l());
        this.readyListeners = null; // clear

        this._off('message', this.serverKeyHandler);
        this._on('message', this.messageHandler);

        if (previousSession && previousSession !== this.sessionId) {
            this.pendingResumeSession = previousSession;
            this.raw_send(encodeResume(previousSession, this.lastReplaySequence));
        }

        this.readQueue.forEach(e => this.messageHandler(e));
        this.readQueue = [];
    }

    private invalidPacket(listened: string) {
        console.error(listened);
        throw new Error("An error occured with data from the server!! This is probably my fault.. make an issue at https://github.com/liwybloc/sonic-ws");
    }

    private listenLock: boolean = false;
    private packetQueue: PacketQueue<ClientPQ> = [];
    
    public async listenPacket(data: string | [any[], boolean], tag: string, packetQueue: PacketQueue<ClientPQ>, isAsync: boolean, asyncData: AsyncPQ<ClientPQ>): Promise<void> {
        const listeners = this.listeners[tag];
        const packet = this.serverPackets.getPacket(tag);
        const parentListeners = packet.parent ? this.listeners[packet.parent] : undefined;
        if (!listeners && !parentListeners) {
            console.warn("Warn: No listener for packet " + tag);
            await this.triggerNextPacket(packetQueue, isAsync, asyncData);
            return;
        }
        if (listeners) await listenPacket(data, listeners, this.invalidPacket);
        if (typeof data !== "string" && packet.parent && packet.variant)
            for (const listener of parentListeners ?? []) await listener({ variant: packet.variant, payload: data[0] });
        await this.triggerNextPacket(packetQueue, isAsync, asyncData);

        await this.callMiddleware('onReceive_post', tag, typeof data == 'string' ? [data] : data[0]);
    }

    private isAsync(code: number): boolean {
        return this.asyncMap[code];
    }
    
    private async enqueuePacket(
        data: string | [any[], boolean],
        listeners: ((...args: any) => void | Promise<void>)[],
        packetQueue: PacketQueue<ClientPQ>, isAsync: boolean, asyncData: AsyncPQ<ClientPQ>
    ): Promise<void> {

        await listenPacket(data, listeners, this.invalidPacket);

        await this.triggerNextPacket(packetQueue, isAsync, asyncData);
    }
    
    private async triggerNextPacket(
        packetQueue: PacketQueue<ClientPQ>,
        isAsync: boolean,
        asyncData: AsyncPQ<ClientPQ>
    ): Promise<void> {
        if (isAsync) asyncData![0] = false;
        else this.listenLock = false;

        if (packetQueue!.length > 0) {
            this.dataHandler(packetQueue!.shift()!);
            return;
        }
    }

    private async dataHandler(data: Uint8Array): Promise<void> {
        if (data[0] === 0) return this.handleControl(data);
        const key = data[0];
        const value = data.slice(1);

        const isAsync = this.isAsync(key);

        let locked: boolean;
        let packetQueue: PacketQueue<ClientPQ>;
        let asyncData: AsyncPQ<ClientPQ>;

        if (isAsync) {
            asyncData = this.asyncData[key]!;
            locked = asyncData[0];
            packetQueue = asyncData[1];
        } else {
            locked = this.listenLock;
            packetQueue = this.packetQueue;
        }

        if (locked) {
            packetQueue.push(data);
            return;
        }

        if (isAsync) asyncData![0] = true;
        else this.listenLock = true;

        const tag = this.serverPackets.getTag(key)!;
        const packet = this.serverPackets.getPacket(tag);

        if(await this.callMiddleware('onReceive_pre', packet.tag, data, data.length)) return;

        if(packet.rereference && value.length == 0) {
            if(packet.lastReceived[0] === undefined) return this.invalidPacket("No previous value to rereference");
            this.listenPacket(packet.lastReceived[0] as any, tag, packetQueue, isAsync, asyncData!);
            return;
        }
        
        if(packet.dataBatching == 0) {
            const res = packet.lastReceived[0] = await packet.listen(value, null);
            this.listenPacket(res, tag, packetQueue, isAsync, asyncData!);
            return;
        }

        const batchData = await BatchHelper.unravelBatch(packet, value, null);
        if(typeof batchData == 'string') return this.invalidPacket(batchData);

        batchData.forEach(data => this.listenPacket(data, tag, packetQueue, isAsync, asyncData!));
    }

    private async handleControl(data: Uint8Array): Promise<void> {
        const message = decodeControl(data);
        if (message.type === ControlType.REPLAY) {
            if (message.sequence <= this.lastReplaySequence) return;
            this.lastReplaySequence = message.sequence;
            await this.dataHandler(message.payload);
            return;
        }
        if (message.type === ControlType.RESUMED) {
            if (message.recovered && this.pendingResumeSession) this.sessionId = this.pendingResumeSession;
            this.pendingResumeSession = undefined;
            this.recoveredListeners.forEach(listener => listener({ recovered: message.recovered, replayed: message.replayed }));
            if (!message.recovered) this.lastReplaySequence = 0;
            return;
        }
        if (message.type === ControlType.RESUME)
            throw new Error("A client cannot receive a recovery request");
        if (message.type === ControlType.RESPONSE) {
            const pending = this.pendingRequests.get(message.id);
            if (!pending) return;
            clearTimeout(pending.timer);
            this.pendingRequests.delete(message.id);
            if (message.ok) pending.resolve(message.value);
            else pending.reject(new Error(String(message.value)));
            return;
        }

        try {
            const tag = this.serverPackets.getTag(message.packetKey);
            if (!tag) throw new Error(`Unknown RPC packet key ${message.packetKey}`);
            const responder = this.responders.get(tag);
            if (!responder) throw new Error(`No responder registered for packet "${tag}"`);
            const decoded = await this.serverPackets.getPacket(tag).listen(message.payload, null);
            if (typeof decoded === "string") throw new Error(decoded);
            const [payload, spread] = decoded;
            const result = spread ? await responder(...payload) : await responder(payload);
            this.raw_send(encodeControlResponse(message.id, true, result ?? null));
        } catch (error) {
            this.raw_send(encodeControlResponse(message.id, false, error instanceof Error ? error.message : String(error)));
        }
    }

    private async messageHandler(event: K): Promise<void> {
        const data = await this.bufferHandler(event);
        if (data.length < 1) return;

        await this.dataHandler(data);
    }

    protected listen(tag: string, listener: (data: any[]) => void): void {
        if (!this.serverPackets.hasTag(tag)) {
            console.log("Tag is not available on server: " + tag);
            return;
        }

        const resolved = this.serverPackets.resolveTag(tag);
        (this.listeners[resolved] ??= []).push(listener);
    }

    private sendQueue: SendQueue = [false, [], undefined];
    
    /**
     * Sends a packet to the server
     * @param tag The tag of the packet
     * @param values The values to send
     */
    public async send(tag: string, ...values: any[]): Promise<void> {
        if(await this.callMiddleware('onSend_pre', tag, values, Date.now(), performance.now())) return;

        const [code, data, packet] = await processPacket(this.clientPackets, tag, values, this.sendQueue, 0);

        if(packet.dataBatching == 0) this.raw_send(toPacketBuffer(code, data));
        else this.batcher.batchPacket(code, data);

        await this.callMiddleware('onSend_post', tag, data, data.length);
    }

    public sendVariant(parent: string, variant: string, ...values: any[]): Promise<void> {
        return this.send(this.clientPackets.getVariantTag(parent, variant), ...values);
    }

    /** Sends a validated packet as an RPC request and waits for its response. */
    public async request(tag: string, ...valuesAndOptions: any[]): Promise<any> {
        const possibleOptions = valuesAndOptions.at(-1);
        const options = valuesAndOptions.length > 1 && possibleOptions && typeof possibleOptions === "object" && !Array.isArray(possibleOptions)
            && Object.keys(possibleOptions).every(key => key === "timeoutMs")
            ? valuesAndOptions.pop() as { timeoutMs?: number }
            : {};
        const [packetKey, payload] = await processPacket(this.clientPackets, tag, valuesAndOptions, this.sendQueue, 0);
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

    /** Registers the client-side responder for server requests using this packet tag. */
    public respond(tag: string, handler: (...values: any[]) => any): void {
        const resolved = this.serverPackets.resolveTag(tag);
        this.responders.set(resolved, handler);
    }

    public async sendSafe(tag: string, ...values: any[]): Promise<boolean> {
        try { await this.send(tag, ...values); return true; }
        catch (error) { console.error(`Failed to send packet "${tag}"`, error); return false; }
    }

    /**
     * Listens for when the client connects
     * @param listener Callback on connection
     */
    public on_ready(listener: () => void): void {
        if (this.pastKeys) listener();
        else (this.readyListeners ??= []).push(listener);
    } 

    /**
     * Listens for when the client closes
     * @param listener Callback on close with close event
     */
    public on_close(listener: (...args: any[]) => void): void {
        this._on("close", listener);
    }

    public on_reconnecting(listener: (event: { attempt: number; delayMs: number }) => void): void { this.reconnectingListeners.push(listener); }
    public on_reconnect(listener: () => void): void { this.reconnectListeners.push(listener); }
    public on_reconnect_failed(listener: () => void): void { this.reconnectFailedListeners.push(listener); }
    public on_recovered(listener: (event: { recovered: boolean; replayed: number }) => void): void { this.recoveredListeners.push(listener); }

    public override close(code: number = 1000, reason?: string | Buffer): void {
        this.intentionalClose = true;
        if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
        super.close(code, reason);
    }

    /**
     * Listens to a packet from the server
     * @param tag The tag to listen for
     * @param listener The callback with the values
     */
    public on(tag: string, listener: (value: any[]) => void): void {
        if (this.socket.readyState !== WebSocket.OPEN) {
            const pending = this.preListen ??= {};
            if (!pending[tag]) pending[tag] = [];
            pending[tag].push(listener);
            return;
        }
        this.listen(tag, listener);
    }

}
