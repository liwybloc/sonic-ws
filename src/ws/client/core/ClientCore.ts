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

import { PacketHolder } from '../../util/packets/PacketHolder';
import { decompressGzip, readVarInt } from '../../util/packets/CompressionUtil';
import { listenPacket, processPacket } from '../../util/packets/PacketUtils';
import { SERVER_SUFFIX, VERSION } from '../../../version';
import { Packet } from '../../packets/Packets';
import { BatchHelper } from '../../util/packets/BatchHelper';
import { as8String, toPacketBuffer } from '../../util/BufferUtil';
import { Connection } from '../../Connection';
import { AsyncPQ, ConnectionMiddleware, ClientPQ, PacketQueue, SendQueue, FuncKeys } from '../../PacketProcessor';

export abstract class SonicWSCore implements Connection {

    /** Raw 'ws' library connection / webjs WebSocket class */
    public socket: WebSocket;

    protected listeners: {
        message: Array<(data: Uint8Array) => void>,
        send: Array<(data: Uint8Array) => void>,
        close: Array<(event: CloseEvent) => void>,
        event: { [key: number]: Array<(...data: any[]) => void> }
    };

    protected preListen: { [key: string]: Array<(data: any[]) => void> } | null;
    protected clientPackets: PacketHolder = new PacketHolder();
    protected serverPackets: PacketHolder = new PacketHolder();

    private pastKeys: boolean = false;
    private readyListeners: Array<() => void> | null = [];

    private batcher: BatchHelper;

    private bufferHandler: (val: MessageEvent) => Promise<Uint8Array>;

    public id: number = -1;

    _timers: Record<number, [number, (closed: boolean) => void, boolean]> = {};

    private asyncData: Record<number, AsyncPQ<ClientPQ>> = {};
    private asyncMap: Record<number, boolean> = {};

    constructor(ws: WebSocket, bufferHandler: (val: MessageEvent) => Promise<Uint8Array>) {
        this.socket = ws;
        this.listeners = {
            message: [],
            send: [],
            close: [],
            event: {},
        };
        this.preListen = {};

        this.batcher = new BatchHelper();

        this.invalidPacket = this.invalidPacket.bind(this);
        this.serverKeyHandler = this.serverKeyHandler.bind(this);
        this.messageHandler = this.messageHandler.bind(this);

        this.socket.addEventListener('message', this.serverKeyHandler);

        this.socket.addEventListener('open', () => this.callMiddleware('onStatusChange', WebSocket.OPEN));

        this.socket.addEventListener('close', event => {
            this.callMiddleware('onStatusChange', WebSocket.CLOSED);
            this.listeners.close.forEach(listener => listener(event));
            for(const [id, callback, shouldCall] of Object.values(this._timers)) {
                this.clearTimeout(id);
                if(shouldCall) callback(true);
            }
            for(const packet of this.clientPackets.getPackets()) {
                delete packet.lastSent[0];
            }
            for(const packet of this.serverPackets.getPackets()) {
                delete packet.lastReceived[0];
            }
        });

        this.bufferHandler = bufferHandler;
    }

    private reading: boolean = false;
    private readQueue: MessageEvent[] = [];
    private async serverKeyHandler(event: MessageEvent) {
        if(this.reading) return this.readQueue.push(event);

        this.reading = true;
        const cdata: Uint8Array = await this.bufferHandler(event);

        if(cdata.length < 3 || as8String(cdata.slice(0, 3)) != SERVER_SUFFIX) {
            this.socket.close(1000);
            throw new Error("The server requested is not a Sonic WS server.");
        }

        const version = cdata[3];
        if(version != VERSION) {
            this.socket.close(1000);
            throw new Error(`Version mismatch: ${version > VERSION ? "client" : "server"} is outdated (server: ${version}, client: ${VERSION})`);              
        }

        const data = await decompressGzip(cdata.subarray(4, cdata.length));

        const [ckOff,id] = readVarInt(data, 0);
        this.id = id;

        const [valuesOff,ckLength] = readVarInt(data, ckOff);
        
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

        Object.keys(this.preListen!).forEach(tag => this.preListen![tag].forEach(listener => {
            // print the error to console without halting execution
            if(!this.serverPackets.hasTag(tag)) return console.error(new Error(`The server does not send the packet with tag "${tag}"!`));
            this.listen(tag, listener);
        }));
        this.preListen = null; // clear

        this.pastKeys = true;

        this.readyListeners!.forEach(l => l());
        this.readyListeners = null; // clear

        this.socket.removeEventListener('message', this.serverKeyHandler);
        this.socket.addEventListener('message', this.messageHandler);

        this.readQueue.forEach(e => this.messageHandler(e));
        this.readQueue = [];
    }

    private invalidPacket(listened: string) {
        console.error(listened);
        throw new Error("An error occured with data from the server!! This is probably my fault.. make an issue at https://github.com/liwybloc/sonic-ws");
    }

    private listenLock: boolean = false;
    private packetQueue: PacketQueue<ClientPQ> = [];
    
    public async listenPacket(data: string | [any[], boolean], code: number, packetQueue: PacketQueue<ClientPQ>, isAsync: boolean, asyncData: AsyncPQ<ClientPQ>): Promise<void> {
        const tag: string = this.serverPackets.getTag(code)!;

        const listeners = this.listeners.event[code];
        if (!listeners) return console.warn("Warn: No listener for packet " + tag);

        await this.enqueuePacket(data, listeners, packetQueue, isAsync, asyncData);

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

    private middlewares: ConnectionMiddleware[] = [];

    addMiddleware(middleware: ConnectionMiddleware): void {
        this.middlewares.push(middleware);

        const m: any = middleware;
        try {
            if (typeof m.init === 'function') m.init(this);
        } catch (e) {
            console.warn('Middleware init threw an error:', e);
        }
    }

    async callMiddleware<K extends FuncKeys<ConnectionMiddleware> & keyof ConnectionMiddleware>(
                method: K,
                ...values: Parameters<NonNullable<Extract<ConnectionMiddleware[K], (...args: any[]) => any>>>
            ): Promise<boolean> {
        let cancelled = false;

        for (const middleware of this.middlewares) {
            const fn = middleware[method];
            if (!fn) continue;

            try {
                if (await (fn as (...args: any[]) => Promise<boolean> | boolean)(...values)) {
                    cancelled = true;
                }
            } catch (e) {
                console.warn(`Middleware ${String(method)} threw an error:`, e);
            }
        }

        return cancelled;
    }

    private async dataHandler(data: Uint8Array): Promise<void> {
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

        const packet = this.serverPackets.getPacket(this.serverPackets.getTag(key)!);

        if(await this.callMiddleware('onReceive_pre', packet.tag, data, data.length)) return;

        if(packet.rereference && value.length == 0) {
            if(packet.lastReceived[0] === undefined) return this.invalidPacket("No previous value to rereference");
            this.listenPacket(packet.lastReceived[0] as any, key, packetQueue, isAsync, asyncData!);
            return;
        }
        
        if(packet.dataBatching == 0) {
            const res = packet.lastReceived[0] = await packet.listen(value, null);
            this.listenPacket(res, key, packetQueue, isAsync, asyncData!);
            return;
        }

        const batchData = await BatchHelper.unravelBatch(packet, value, null);
        if(typeof batchData == 'string') return this.invalidPacket(batchData);

        batchData.forEach(data => this.listenPacket(data, key, packetQueue, isAsync, asyncData!));
    }

    private async messageHandler(event: MessageEvent): Promise<void> {
        const data = await this.bufferHandler(event);

        this.listeners.message.forEach(listener => listener(data));
        if (data.length < 1) return;

        await this.dataHandler(data);
    }

    protected listen(key: string, listener: (data: any[]) => void): void {
        const skey = this.serverPackets.getKey(key);
        if (skey == null) {
            console.log("Key is not available on server: " + key);
            return;
        }

        if (!this.listeners.event[skey]) this.listeners.event[skey] = [];
        this.listeners.event[skey].push(listener);
    }

    /**
     * Listens for all messages rawly
     * @param listener Callback for when data is received
     */
    public raw_onmessage(listener: (data: Uint8Array) => void): void {
        this.listeners.message.push(listener);
    }

    /**
     * Listens for all sent messages rawly
     * @param listener Callback for when data is received
     */
    public raw_onsend(listener: (data: Uint8Array) => void): void {
        this.listeners.send.push(listener);
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

    /**
     * Listens for when the client connects
     * @param listener Callback on connection
     */
    public on_ready(listener: () => void): void {
        if (this.pastKeys) listener();
        else this.readyListeners!.push(listener);
    }

    /**
     * Listens for when the client closes
     * @param listener Callback on close with close event
     */
    public on_close(listener: (event: CloseEvent) => void): void {
        this.listeners.close.push(listener);
    }

    /**
     * Listens to a packet from the server
     * @param tag The tag to listen for
     * @param listener The callback with the values
     */
    public on(tag: string, listener: (value: any[]) => void): void {
        if (this.socket.readyState !== WebSocket.OPEN) {
            if (!this.preListen![tag]) this.preListen![tag] = [];
            this.preListen![tag].push(listener);
            return;
        }
        this.listen(tag, listener);
    }

    /* JSDocs in Connection.ts class */

    public raw_send(data: Uint8Array): void {
        this.listeners.send.forEach(d => d(data));
        this.socket.send(data);
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

    public close(code?: number, reason?: string): void {
        this.socket.close(code, reason);
    }

}
