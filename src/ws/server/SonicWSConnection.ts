/*
 * Copyright 2025 Lily (liwybloc)
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
import { as8String, toPacketBuffer } from '../util/BufferUtil';
import { Connection } from '../Connection';

const CLIENT_RATELIMIT_TAG = "C", SERVER_RATELIMIT_TAG = "S";

export class SonicWSConnection implements Connection {

    /** Raw 'ws' library socket */
    public socket: WS.WebSocket;

    private host: SonicWSServer;

    private listeners: Record<string, Array<(...data: any[]) => void>>;

    private print: boolean = false;
    
    private handshakePacket: string | null;
    private handshakeLambda!: (data: WS.MessageEvent) => void;

    private messageLambda = (data: WS.MessageEvent) => this.messageHandler(this.parseData(data));
    private handshakedMessageLambda = (data: WS.MessageEvent) => {
        const parsed = this.parseData(data);
        if(parsed == null) return;
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

    timers: Record<number, number> = {};

    constructor(socket: WS.WebSocket, host: SonicWSServer, id: number, handshakePacket: string | null, clientRateLimit: number, serverRateLimit: number) {
        this.socket = socket;
        this.host = host;

        this.id = id;
        
        this.handshakePacket = handshakePacket;

        this.listeners = {};
        for (const key of host.clientPackets.getTags()) {
            this.listeners[key] = [];
            this.enabledPackets[key] = host.clientPackets.getPacket(key).defaultEnabled;
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

        this.socket.on('close', () => {
            Object.values(this.timers).forEach(clearTimeout);
        });
    }

    private parseData(event: WS.MessageEvent): [key: string, value: Uint8Array] | null {
        if(this.rater.trigger(CLIENT_RATELIMIT_TAG)) return null;
        if (!(event.data instanceof Buffer)) return null;

        const message = new Uint8Array(event.data);

        if(this.print) console.log(`\x1b[31m⬇ \x1b[38;5;245m(${this.id},${message.byteLength})\x1b[0m ${this.hideNewLines(message)}`);

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

        const tag = this.host.clientPackets.getTag(key);

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
        if(parsed == null) return;

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
        this.socket.close(4003);
        console.log("Closure cause:", listened);
    }

    private listenPacket(data: string | [any[], boolean], tag: string) {
        listenPacket(data, this.listeners[tag], this.invalidPacket);
    }

    private messageHandler(data: [tag: string, value: Uint8Array] | null): void {
        if(data == null) return;

        const [tag, value] = data;

        const packet = this.host.clientPackets.getPacket(tag);

        if(packet.dataBatching == 0) {
            const res = packet.listen(value, this);
            this.listenPacket(res, tag);
            return;
        }

        const batchData = BatchHelper.unravelBatch(packet, value, this);
        if(typeof batchData == 'string') return this.invalidPacket(batchData);

        for(const data of batchData) {
            this.listenPacket(data, tag);
        }
    }

    private hideNewLines(str: Uint8Array): string {
        return Array.from(as8String(str)).map(x => x == "\n" ? "☺" : x).join("");
    }

    /** Sends raw data to the user; will likely fail validity checks if used externally */
    public raw_send(data: Uint8Array): void {
        if(this.isClosed()) throw new Error("Connection is already closed!");
        if(this.rater.trigger(SERVER_RATELIMIT_TAG)) return;
        if(this.print) console.log(`\x1b[32m⬆ \x1b[38;5;245m(${this.id},${data.byteLength})\x1b[0m ${this.hideNewLines(data)}`);
        this.socket.send(data);
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
        return this.socket.readyState == WS.CLOSED;
    }

    /**
     * Listens for when the connection closes
     * @param listener Called when it closes
     */
    public on_close(listener: (code: number, reason: Buffer) => void): void {
        this.socket.on('close', listener);
    }

    /**
     * Listens for a packet
     * @param tag The tag of the key to listen for
     * @param listener A function to listen for it
     */
    public on(tag: string, listener: (...values: any) => void): void {
        if (!this.host.clientPackets.hasTag(tag)) throw new Error(`Tag "${tag}" has not been created!`);

        if (!this.listeners[tag]) this.listeners[tag] = [];
        this.listeners[tag].push(listener);
    }

    /**
     * For internal use.
     */
    public send_processed(code: number, data: number[], packet: Packet) {
        if(this.rater.trigger("server" + code)) return;

        if(packet.dataBatching == 0) this.raw_send(toPacketBuffer(code, data));
        else this.batcher.batchPacket(code, data);
    }

    /**
     * Sends a packet with the tag and values
     * @param tag The tag to send
     * @param values The values to send
     */
    public send(tag: string, ...values: any[]) {
        this.send_processed(...processPacket(this.host.serverPackets, tag, values));
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

    /**
     * Closes the connection
     */
    public close(code?: number, reason?: string): void {
        this.socket.close(code, reason);
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
        this.timers[timeout] = timeout;
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
        this.timers[interval] = interval;
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

}