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
import { NULL } from '../../util/packets/CodePointUtil';
import { listenPacket, processPacket } from '../../util/packets/PacketUtils';
import { VERSION } from '../../../version';
import { Packet } from '../../packets/Packets';
import { BatchHelper } from '../../util/packets/BatchHelper';

// throttle at 90% of rate limit to avoid spikes and kicks
const THRESHOLD_MULT = 0.90;

export abstract class SonicWSCore {

    /** Raw 'ws' library connection / webjs WebSocket class */
    public socket: WebSocket;

    protected listeners: {
        message: Array<(data: string) => void>,
        close: Array<(event: CloseEvent) => void>,
        event: { [key: string]: Array<(...data: any[]) => void> }
    };

    protected preListen: { [key: string]: Array<(data: any[]) => void> } | null;
    protected clientPackets: PacketHolder = new PacketHolder();
    protected serverPackets: PacketHolder = new PacketHolder();

    private pastKeys: boolean = false;
    private readyListeners: Array<() => void> | null = [];
    private keyHandler: ((event: MessageEvent) => undefined) | null;

    private sendQueue: string[] = [];

    private timers: number[] = [];

    private batcher: BatchHelper;

    public id: number = -1;

    constructor(ws: WebSocket) {
        this.socket = ws;
        this.listeners = {
            message: [],
            close: [],
            event: {},
        };
        this.preListen = {};

        this.batcher = new BatchHelper();
        this.invalidPacket = this.invalidPacket.bind(this);

        this.keyHandler = event => this.serverKeyHandler(event);
        this.socket.addEventListener('message', this.keyHandler); // lambda to persist 'this'

        this.socket.addEventListener('close', (event: CloseEvent) => {
            this.listeners.close.forEach(listener => listener(event));
            this.timers.forEach(clearTimeout);
        });
    }

    private serverKeyHandler(event: MessageEvent): undefined {
        const data: string = event.data.toString();
        if(!data.startsWith("SWS")) {
            this.socket.close(1000);
            throw new Error("The server requested is not a Sonic WS server.");
        }

        const version = data.charCodeAt(3);
        if(version != VERSION) {
            this.socket.close(1000);
            throw new Error(`Version mismatch: ${version > VERSION ? "client" : "server"} is outdated (server: ${version}, client: ${VERSION})`);              
        }

        const [ckData, skData, uData] = data.substring(4).split(NULL);
        this.clientPackets.holdPackets(Packet.deserializeAll(ckData, true));
        this.serverPackets.holdPackets(Packet.deserializeAll(skData, true));

        this.batcher.registerSendPackets(this.clientPackets, this);

        Object.keys(this.preListen!).forEach(tag => this.preListen![tag].forEach(listener => {
            const key = this.serverPackets.get(tag);
            // print the error to console without halting execution
            if(key == null) return console.error(new Error(`The server does not send the packet with tag "${tag}"!`));

            this.listen(tag, listener);
        }));
        this.preListen = null; // clear

        this.pastKeys = true;

        this.readyListeners!.forEach(l => l());
        this.readyListeners = null; // clear

        this.socket.removeEventListener('message', this.keyHandler!);
        this.socket.addEventListener('message', event => this.messageHandler(event)); // lambda to persist 'this'

        this.keyHandler = null;
    }

    private invalidPacket(listened: string) {
        console.log(listened);
        throw new Error("An error occured with data from the server!! This is probably my fault.. make an issue at https://github.com/cutelittlelily/sonic-ws");
    }

    private listenPacket(data: string | [any[], boolean], code: string) {
        listenPacket(data, this.listeners.event[code], this.invalidPacket);
    }

    private messageHandler(event: MessageEvent) {
        let data = event.data.toString();

        this.listeners.message.forEach(listener => listener(data));
        if (data.length < 1) return;

        const key = data.substring(0, 1);
        const value = data.substring(1);
        const code = key.charCodeAt(0);
        if (code == null) return;

        const packet = this.serverPackets.getPacket(this.serverPackets.getTag(key));
        
        if(packet.dataBatching == 0) {
            this.listenPacket(packet.listen(value, null), code);
            return;
        }

        const batchData = BatchHelper.unravelBatch(packet, value, null);
        if(typeof batchData == 'string') return this.invalidPacket(batchData);

        batchData.forEach(data => this.listenPacket(data, code));
        
    }

    protected listen(key: string, listener: (data: any[]) => void) {
        const skey = this.serverPackets.get(key);
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
    public raw_onmessage(listener: (data: string) => void): void {
        this.listeners.message.push(listener);
    }

    /**
     * Sends raw data
     */
    public raw_send(data: string): void {
        this.socket.send(data);
    }

    /**
     * Sends a packet to the server
     * @param tag The tag of the packet
     * @param values The values to send
     */
    public send(tag: string, ...values: any[]): void {
        const [code, data, packet] = processPacket(this.clientPackets, tag, values);
        if(packet.dataBatching == 0) this.raw_send(code + data);
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

    /**
     * Sets a timeout that will automatically end when the socket closes
     * @param call The function to call
     * @param time The time between now and the call (ms)
     */
    public setTimeout(call: () => void, time: number): number {
        const timeout = setTimeout(call, time) as unknown as number;
        this.timers.push(timeout);
        return timeout;
    }

    /**
     * Sets an interval that will automatically end when the socket closes
     * @param call The function to call
     * @param time The time between calls (ms)
     */
    public setInterval(call: () => void, time: number): number {
        const interval = setInterval(call, time) as unknown as number;
        this.timers.push(interval);
        return interval;
    }

}