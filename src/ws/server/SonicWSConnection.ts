/*
 * Copyright 2026 Lily (liwybloc)
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

import * as WS from 'ws';
import { SonicWSServer } from './SonicWSServer';
import { listenPacket, processPacket } from '../util/packets/PacketUtils';
import { BatchHelper } from '../util/packets/BatchHelper';
import { Packet } from '../packets/Packets';
import { RateHandler } from '../util/packets/RateHandler';
import { stringifyBuffer, toPacketBuffer } from '../util/BufferUtil';
import { Connection } from '../Connection';
import { AsyncPQ, ConnectionMiddleware, PacketQueue, SendQueue, ServerPQ } from '../PacketProcessor';
const CLIENT_RATELIMIT_TAG = "C", SERVER_RATELIMIT_TAG = "S";

export class SonicWSConnection implements Connection {

    /** Raw 'ws' library socket */
    public socket: WS.WebSocket;

    private host: SonicWSServer;

    private listeners: Record<string, Array<(...data: any[]) => void>>;

    private print: boolean = false;
    private name: string;
    
    private handshakePacket: string | null;
    private handshakeLambda!: (data: WS.MessageEvent) => void;

    private messageLambda = (data: WS.MessageEvent) => this.messageHandler(this.parseData(data));
    private handshakedMessageLambda = (data: WS.MessageEvent) => {
        const parsed = this.parseData(data);
        if(parsed == null) return this.socket.close(4004);
        if(parsed[0] == this.handshakePacket) return this.socket.close(4005);
        this.messageHandler(parsed);
    }

    private batcher: BatchHelper;
    private rater: RateHandler;

    private enabledPackets: Record<string, boolean> = {};

    /** If the packet handshake has been completed; `wss.requireHandshake(packet)` */
    public handshakeComplete: boolean = false;
    
    /** The index of the connection; unique for all connected, recycles old disconnected ids. Should be safe for INTS_C unless you have more than 27,647 connected at once. */
    public id: number;
    _timers: Record<number, [number, (closed: boolean) => void, boolean]> = {};

    private asyncMap: Record<string, boolean> = {};
    private asyncData: Record<string, [boolean, PacketQueue<ServerPQ>]> = {};

    private closed: boolean = false;

    constructor(socket: WS.WebSocket, host: SonicWSServer, id: number, handshakePacket: string | null, clientRateLimit: number, serverRateLimit: number) {
        this.socket = socket;
        this.host = host;

        this.id = id;
        this.name = "Socket " + id;
        
        this.handshakePacket = handshakePacket;

        this.listeners = {};
        for (const tag of host.clientPackets.getTags()) {
            this.listeners[tag] = [];
            const pack = host.clientPackets.getPacket(tag);
            pack.lastReceived[this.id] = undefined;
            this.enabledPackets[tag] = pack.defaultEnabled;
            this.asyncMap[tag] = pack.async;
            if(pack.async) this.asyncData[tag] = [false, []];
        }

        this.setInterval = this.setInterval.bind(this);

        this.batcher = new BatchHelper();
        this.batcher.registerSendPackets(this.host.serverPackets, this);
        this.invalidPacket = this.invalidPacket.bind(this);

        this.rater = new RateHandler(this);

        this.rater.registerRate(CLIENT_RATELIMIT_TAG, clientRateLimit);
        this.rater.registerRate(SERVER_RATELIMIT_TAG, serverRateLimit);

        this.rater.registerAll(host.clientPackets, "client");
        this.rater.registerAll(host.serverPackets, "server");

        this.rater.start();

        if(this.handshakePacket == null) {
            this.socket.addEventListener('message', this.messageLambda);
        } else {
            this.handshakeLambda = (data: WS.MessageEvent) => this.handshakeHandler(data);
            this.socket.addEventListener('message', this.handshakeLambda);
        }

        this.socket.on('open', () => this.callMiddleware('onStatusChange', WebSocket.OPEN));

        this.socket.on('close', () => {
            this.callMiddleware('onStatusChange', WebSocket.CLOSED);
            this.closed = true;
            for(const [id, callback, shouldCall] of Object.values(this._timers)) {
                this.clearTimeout(id);
                if(shouldCall) callback(true);
            }
            for (const packet of host.clientPackets.getPackets()) {
                delete packet.lastReceived[this.id];
            }
            for (const packet of host.serverPackets.getPackets()) {
                delete packet.lastSent[this.id];
            }
        });
    }

    private parseData(event: WS.MessageEvent): [key: string, value: Uint8Array] | null {
        if(this.rater.trigger(CLIENT_RATELIMIT_TAG)) return null;
        if (!(event.data instanceof Buffer)) return null;

        const message = new Uint8Array(event.data);

        if(this.print)
            console.log(`\x1b[31m⬇ \x1b[38;5;245m(${this.id},${message.byteLength})\x1b[0m`,
            (message.length > 0 && this.host.clientPackets.getTag(message[0])) || "<INVALID>", stringifyBuffer(message));

        if (message.byteLength < 1) {
            this.socket.close(4001);
            return null;
        }

        const key = message[0];
        const value = message.slice(1);

        // not a key, bye bye
        if(!this.host.clientPackets.hasKey(key)) {
            this.socket.close(4002);
            return null;
        }

        const tag = this.host.clientPackets.getTag(key)!;

        // disabled, bye bye
        if(!this.enabledPackets[tag]) {
            this.socket.close(4006);
            return null;
        }

        if(this.rater.trigger("client" + key)) return null;

        return [tag, value];
    }

    private handshakeHandler(data: WS.MessageEvent): void {
        const parsed = this.parseData(data);
        if(parsed == null) return this.socket.close(4004);

        if(parsed[0] != this.handshakePacket) {
            this.socket.close(4004);
            return;
        }

        this.messageHandler(parsed);

        this.socket.removeEventListener('message', this.handshakeLambda);
        this.socket.addEventListener('message', this.handshakedMessageLambda);

        this.handshakeComplete = true;
    }

    private invalidPacket(listened: string) {
        console.log("Closure cause", listened);
        this.socket.close(4003, listened);
    }
    
    private isAsync(tag: string): boolean {
        return this.asyncMap[tag];
    }

    private listenLock: boolean = false;
    private packetQueue: PacketQueue<ServerPQ> = [];

    private async listenPacket(data: string | [any[], boolean], tag: string, packetQueue: PacketQueue<ServerPQ>, isAsync: boolean, asyncData: AsyncPQ<ServerPQ>): Promise<void> {
        if (this.closed) return;
        if(await this.callMiddleware('onReceive_post', tag, typeof data == 'string' ? [data] : data[0])) return;

        await listenPacket(data, this.listeners[tag], this.invalidPacket);

        if (isAsync) asyncData![0] = false;
        else this.listenLock = false;

        if (packetQueue!.length != 0) {
            this.messageHandler(packetQueue!.shift()!);
            return;
        }
    }

    private async messageHandler(data: [tag: string, value: Uint8Array] | null, recall: boolean = false): Promise<void> {
        if(data == null) return;

        const [tag, value] = data;

        const isAsync = this.isAsync(tag);

        let locked, packetQueue, asyncData;
        if(isAsync) {
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

        if (isAsync) asyncData![0] = true;
        else this.listenLock = true;

        const packet = this.host.clientPackets.getPacket(tag);
        if(!recall && await this.callMiddleware('onReceive_pre', packet.tag, value, value.length)) return;

        if(packet.rereference && value.length == 0) {
            const lastRecv = packet.lastReceived[this.id];
            if(lastRecv === undefined) return this.invalidPacket("No previous value to rereference");
            this.listenPacket(lastRecv as any, tag, packetQueue, isAsync, asyncData!);
            return;
        }

        if(packet.dataBatching == 0) {
            const res = await packet.listen(value, this);
            packet.lastReceived[this.id] = res;
            this.listenPacket(res, tag, packetQueue, isAsync, asyncData!);
            return;
        }

        const batchData = await BatchHelper.unravelBatch(packet, value, this);
        if(typeof batchData == 'string') return this.invalidPacket(batchData);

        for(const data of batchData) {
            this.listenPacket(data, tag, packetQueue, isAsync, asyncData!);
        }
    }

    private basicMiddlewares: ConnectionMiddleware[] = [];

    addBasicMiddleware(middleware: ConnectionMiddleware): void {
        this.basicMiddlewares.push(middleware);

        const m: any = middleware;
        try {
            if (typeof m.init === 'function') m.init(this);
        } catch (e) {
            console.warn('Middleware init threw an error:', e);
        }
    }

    private async callMiddleware<K extends keyof ConnectionMiddleware>(
        method: K,
        ...values: Parameters<NonNullable<ConnectionMiddleware[K]>>
    ): Promise<boolean> {
        let cancelled = false;

        for (const middleware of this.basicMiddlewares) {
            const fn = middleware[method];
            if (!fn) continue;

            try {
                if (!await (fn as (...args: any[]) => Promise<boolean> | boolean)(...values)) {
                    cancelled = true;
                }
            } catch (e) {
                console.warn(`Middleware ${String(method)} threw an error:`, e);
            }
        }

        return cancelled;
    }

    /**
     * Enables a packet for the client.
     * @param tag The tag of the packet
     */
    public enablePacket(tag: string) {
        this.enabledPackets[tag] = true;
    }
    /**
     * Disables a packet for the client.
     * @param tag The tag of the packet
     */
    public disablePacket(tag: string) {
        this.enabledPackets[tag] = false;
    }

    /**
     * Checks if the connection is closed
     * @returns If it's closed or not
     */
    public isClosed(): boolean {
        return this.closed || this.socket.readyState == WS.CLOSED;
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
        if (!this.host.clientPackets.hasTag(tag as string))
            throw new Error(`Tag "${String(tag)}" has not been created!`);
        this.listeners[tag as string] ??= [];
        this.listeners[tag as string].push(listener as any);
    }

    /**
     * For internal use.
     */
    public send_processed(code: number, data: Uint8Array, packet: Packet<any>) {
        if(this.rater.trigger("server" + code)) return;

        if(packet.dataBatching == 0) this.raw_send(toPacketBuffer(code, data));
        else this.batcher.batchPacket(code, data);
    }

    private sendQueue: SendQueue = [false, [], undefined];

    /**
     * Sends a packet with the tag and values
     * @param tag The tag to send
     * @param values The values to send
     */
    public async send(tag: string, ...values: any[]): Promise<void> {
        if(await this.callMiddleware('onSend_pre', tag, values)) return;
        const [code, data, packet] = await processPacket(this.host.serverPackets, tag, values, this.sendQueue, this.id);
        if(await this.callMiddleware('onSend_post', tag, data, data.length))  return;
        this.send_processed(code, data, packet);
    }

    /**
     * Broadcasts a packet to all other users connected
     * @param tag The tag to send
     * @param values The values to send
     */
    public broadcastFiltered(tag: string, filter: (socket: SonicWSConnection) => boolean, ...values: any[]) {
        this.host.broadcastFiltered(tag, (socket) => socket != this && filter(socket), ...values);
    }

    /**
     * Broadcasts a packet to all other users connected
     * @param tag The tag to send
     * @param values The values to send
     */
    public broadcast(tag: string, ...values: any[]) {
        this.broadcastFiltered(tag, () => true, ...values);
    }

    /**
     * Toggles printing all sent and received messages
     */
    public togglePrint(): void {
        this.print = !this.print;
    }

    /* JSDocs in Connection.ts class */

    public raw_send(data: Uint8Array): void {
        if(this.isClosed()) {
            console.warn("WARN! Connection already closed when trying to send message!", this.id, stringifyBuffer(data));
            return;
        }
        if(this.rater.trigger(SERVER_RATELIMIT_TAG)) return;
        if(this.print)
            console.log(`\x1b[32m⬆ \x1b[38;5;245m(${this.id},${data.byteLength})\x1b[0m`,
            (data.length > 0 && this.host.serverPackets.getTag(data[0])) || "<INVALID>", stringifyBuffer(data));
        this.socket.send(data);
    }

    public close(code: number = 1000, reason?: string | Buffer): void {
        this.closed = true;
        this.socket.close(code, reason);
    }

    public setTimeout(call: () => void, time: number, callOnClose: boolean = false): number {
        const timeout = setTimeout(() => {
            call();
            this.clearTimeout(timeout);
        }, time) as unknown as number;
        this._timers[timeout] = [timeout, call, callOnClose];
        return timeout;
    }

    public setInterval(call: () => void, time: number, callOnClose: boolean = false): number {
        const interval = setInterval(call, time) as unknown as number;
        this._timers[interval] = [interval, call, callOnClose];
        return interval;
    }

    public clearTimeout(id: number): void {
        clearTimeout(id);
        delete this._timers[id];
    }

    public clearInterval(id: number): void {
        this.clearTimeout(id);
    }

    /**
     * Tags the socket with a key
     * @param tag The tag to add
     * @param replace If it should replace a previous tag; defaults to true. If using false, you can add multiple tags.
     */
    public tag(tag: string, replace: boolean = true) {
        this.host.tag(this, tag, replace);
    }
    
    /**
     * Sets the name of this connection for the debug menu; good for setting e.g. usernames on games
     */
    public setName(name: string): void {
        this.name = name;
    }

    /**
     * @returns Name of the socket, defaults to Socket [ID] unless set with setName()
     */
    public getName(): string {
        return this.name;
    }

}