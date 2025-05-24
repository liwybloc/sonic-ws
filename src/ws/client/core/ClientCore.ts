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

import { PacketHolder } from '../../util/packets/PacketHolder';
import { NULL, readVarInt } from '../../util/packets/CompressionUtil';
import { listenPacket, processPacket } from '../../util/packets/PacketUtils';
import { SERVER_SUFFIX, VERSION } from '../../../version';
import { Packet } from '../../packets/Packets';
import { BatchHelper } from '../../util/packets/BatchHelper';
import { asString, splitBufferAt, toPacketBuffer } from '../../util/BufferUtil';
import { Connection } from '../../Connection';

export abstract class SonicWSCore implements Connection {

    /** Raw 'ws' library connection / webjs WebSocket class */
    public socket: WebSocket;

    protected listeners: {
        message: Array<(data: Uint8Array) => void>,
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

    timers: Record<number, number> = {};

    constructor(ws: WebSocket, bufferHandler: (val: MessageEvent) => Promise<Uint8Array>) {
        this.socket = ws;
        this.listeners = {
            message: [],
            close: [],
            event: {},
        };
        this.preListen = {};

        this.batcher = new BatchHelper();

        this.invalidPacket = this.invalidPacket.bind(this);
        this.serverKeyHandler = this.serverKeyHandler.bind(this);
        this.messageHandler = this.messageHandler.bind(this);

        this.socket.addEventListener('message', this.serverKeyHandler);

        this.socket.addEventListener('close', (event: CloseEvent) => {
            this.listeners.close.forEach(listener => listener(event));
            Object.values(this.timers).forEach(clearTimeout);
        });

        this.bufferHandler = bufferHandler;
    }

    private reading: boolean = false;
    private async serverKeyHandler(event: MessageEvent) {
        // stupid asynchronous bullshit
        if(this.reading) return this.messageHandler(event);
        this.reading = true;
        const data: Uint8Array = await this.bufferHandler(event);

        if(data.length < 3 || asString(data.slice(0, 3)) != SERVER_SUFFIX) {
            this.socket.close(1000);
            throw new Error("The server requested is not a Sonic WS server.");
        }

        if(data.length == 3) {
            // todo: queue
            return;
        }

        const version = data[3];
        if(version != VERSION) {
            this.socket.close(1000);
            throw new Error(`Version mismatch: ${version > VERSION ? "client" : "server"} is outdated (server: ${version}, client: ${VERSION})`);              
        }

        const [off,ckLength] = readVarInt(data, 4, false);
        const ckData = data.slice(off, off + ckLength);
        this.clientPackets.holdPackets(Packet.deserializeAll(ckData, true));
        const skData = data.slice(off + ckLength, data.length - 1);
        this.serverPackets.holdPackets(Packet.deserializeAll(skData, true));

        this.id = data[data.length - 1];

        this.batcher.registerSendPackets(this.clientPackets, this);

        Object.keys(this.preListen!).forEach(tag => this.preListen![tag].forEach(listener => {
            const key = this.serverPackets.getKey(tag);
            // print the error to console without halting execution
            if(key == null) return console.error(new Error(`The server does not send the packet with tag "${tag}"!`));

            this.listen(tag, listener);
        }));
        this.preListen = null; // clear

        this.pastKeys = true;

        this.readyListeners!.forEach(l => l());
        this.readyListeners = null; // clear

        this.socket.removeEventListener('message', this.serverKeyHandler);
        this.socket.addEventListener('message', this.messageHandler);
    }

    private invalidPacket(listened: string) {
        console.log(listened);
        throw new Error("An error occured with data from the server!! This is probably my fault.. make an issue at https://github.com/cutelittlelily/sonic-ws");
    }

    private listenPacket(data: string | [any[], boolean], code: number): void {
        const listeners = this.listeners.event[code];
        if(!listeners) return console.warn("Warn: No listener for packet " + this.serverPackets.getTag(code));
        listenPacket(data, listeners, this.invalidPacket);
    }

    private async messageHandler(event: MessageEvent) {
        const data = await this.bufferHandler(event);

        this.listeners.message.forEach(listener => listener(data));
        if (data.length < 1) return;

        const key = data[0];
        const value = data.slice(1);

        const packet = this.serverPackets.getPacket(this.serverPackets.getTag(key));
        
        if(packet.dataBatching == 0) {
            this.listenPacket(packet.listen(value, null), key);
            return;
        }

        const batchData = BatchHelper.unravelBatch(packet, value, null);
        if(typeof batchData == 'string') return this.invalidPacket(batchData);

        batchData.forEach(data => this.listenPacket(data, key));
        
    }

    protected listen(key: string, listener: (data: any[]) => void) {
        const skey = this.serverPackets.getKey(key);
        if (!skey) {
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
     * Sends raw data
     */
    public raw_send(data: Uint8Array): void {
        this.socket.send(data);
    }

    /**
     * Sends a packet to the server
     * @param tag The tag of the packet
     * @param values The values to send
     */
    public send(tag: string, ...values: any[]): void {
        const [code, data, packet] = processPacket(this.clientPackets, tag, values);
        if(packet.dataBatching == 0) this.raw_send(toPacketBuffer(code, data));
        else this.batcher.batchPacket(code, data);
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

    private setTimer(id: number) {
        this.timers[id] = id;
    }

    /**
     * Sets a timeout that will automatically end when the socket closes
     * @param call The function to call
     * @param time The time between now and the call (ms)
     * @returns The timeout id to be used with socket.clearInterval(id)
     */
    public setTimeout(call: () => void, time: number): number {
        const timeout = setTimeout(() => {
            call();
            this.clearTimeout(timeout);
        }, time) as unknown as number;
        this.setTimer(timeout);
        return timeout;
    }

    /**
     * Sets an interval that will automatically end when the socket closes
     * @param call The function to call
     * @param time The time between calls (ms)
     * @returns The interval id to be used with socket.clearInterval(id)
     */
    public setInterval(call: () => void, time: number): number {
        const interval = setInterval(call, time) as unknown as number;
        this.setTimer(interval);
        return interval;
    }

    /**
     * Clears a timeout
     * @param id The timeout id
     */
    public clearTimeout(id: number): void {
        clearTimeout(id);
        delete this.timers[id];
    }
    /**
     * Clears an interval
     * @param id The interval id
     */
    public clearInterval(id: number): void {
        this.clearTimeout(id);
    }

    /**
     * Closes the connection
     */
    public close(code?: number, reason?: string): void {
        this.socket.close(code, reason);
    }

}
