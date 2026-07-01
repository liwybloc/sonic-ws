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
import { decompressGzip, readVarInt } from "../../util/packets/CompressionUtil";
import { listenPacket, processPacket } from "../../util/packets/PacketUtils";
import { SERVER_SUFFIX, VERSION } from "../../../version";
import { Packet } from "../../packets/Packets";
import { BatchHelper } from "../../util/packets/BatchHelper";
import { toPacketBuffer } from "../../util/BufferUtil";
import { Connection } from "../../Connection";
import { AsyncPQ, ClientPQ, PacketQueue, SendQueue } from "../../PacketProcessor";
import { as8String } from "../../util/StringUtil";

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

    constructor(ws: T, bufferHandler: (val: K) => Promise<Uint8Array>, on: Function, off: Function) {
        super(ws, -1, "LocalSocket", on, off);

        this.socket = ws;
        this.preListen = {};

        this.invalidPacket = this.invalidPacket.bind(this);
        this.serverKeyHandler = this.serverKeyHandler.bind(this);
        this.messageHandler = this.messageHandler.bind(this);

        this._on('message', this.serverKeyHandler);

        this._on('close', () => {
            this.callMiddleware('onStatusChange', WebSocket.CLOSED);
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

        this._off('message', this.serverKeyHandler);
        this._on('message', this.messageHandler);

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

        (this.listeners[tag] ??= []).push(listener);
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
        this._on("close", listener);
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

}
