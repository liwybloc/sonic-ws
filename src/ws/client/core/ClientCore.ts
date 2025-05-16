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

import { PacketHolder } from '../../util/PacketHolder';
import { NULL } from '../../util/CodePointUtil';
import { emitPacket } from '../../util/PacketUtils';
import { VERSION } from '../../../version';
import { Packet } from '../../packets/Packets';

export abstract class SonicWSCore {
    protected ws: WebSocket;
    protected listeners: {
        message: Array<(data: string) => void>,
        close: Array<(event: CloseEvent) => void>,
        event: { [key: string]: Array<(...data: any[]) => void> }
    };

    protected preListen: { [key: string]: Array<(data: any[]) => void> } | null;
    protected clientPackets: PacketHolder = PacketHolder.empty();
    protected serverPackets: PacketHolder = PacketHolder.empty();

    private pastKeys: boolean = false;
    private readyListeners: Array<() => void> | null = [];
    private keyHandler: ((event: MessageEvent) => undefined) | null;

    private rateLimitTimeout: number = -1;
    private rateLimit: number = -1;
    private sentPackets: number = 0;
    private sendQueue: string[] = [];

    constructor(ws: WebSocket) {
        this.ws = ws;
        this.listeners = {
            message: [],
            close: [],
            event: {},
        };
        this.preListen = {};

        this.keyHandler = event => this.serverKeyHandler(event);
        this.ws.addEventListener('message', this.keyHandler); // lambda to persist 'this'

        this.ws.addEventListener('close', (event: CloseEvent) => {
            this.listeners.close.forEach(listener => listener(event));
            if(this.rateLimit != 0 && this.rateLimitTimeout != -1) clearInterval(this.rateLimitTimeout);
        });
    }

    private serverKeyHandler(event: MessageEvent): undefined {
        const data: string = event.data.toString();
        if(!data.startsWith("SWS")) {
            this.ws.close(1000);
            throw new Error("The server requested is not a Sonic WS server.");
        }

        const version = data.charCodeAt(3);
        if(version != VERSION) {
            this.ws.close(1000);
            throw new Error(`Version mismatch: ${version > VERSION ? "client" : "server"} is outdated (server: ${version}, client: ${VERSION})`);              
        }

        const [ckData, skData, rateLimit] = data.substring(4).split(NULL);
        this.clientPackets.createPackets(Packet.deserializeAll(ckData, true));
        this.serverPackets.createPackets(Packet.deserializeAll(skData, true));

        this.rateLimit = rateLimit.charCodeAt(0);

        if(this.rateLimit != 0) {
            this.rateLimitTimeout = setInterval(() => {
                this.sentPackets = 0;

                const toSend = [...this.sendQueue];
                this.sendQueue = [];
                toSend.forEach(p => this.raw_send(p));
            }, 1000) as unknown as number;
        }

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

        this.ws.removeEventListener('message', this.keyHandler!);
        this.ws.addEventListener('message', event => this.messageHandler(event)); // lambda to persist 'this'

        this.keyHandler = null;
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
        const result = packet.listen(value);
        if(typeof result == 'string') {
            console.log(result);
            throw new Error("An error occured with data from the server!! This is probably my fault.. make an issue at https://github.com/cutelittlelily/sonic-ws");
        }
        const [processed, flatten] = result;

        if(flatten) this.listeners.event[code]?.forEach(l => l(...processed));
        else this.listeners.event[code]?.forEach(l => l(processed));
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

    public raw_onmessage(listener: (data: string) => void): void {
        this.listeners.message.push(listener);
    }

    public raw_send(data: string): void {
        if(this.rateLimit == -1) return console.error("A rate limit has not been received by the server!");
        if(this.rateLimit != 0 && ++this.sentPackets > this.rateLimit) {
            this.sendQueue.push(data);
            return console.warn(`Client is emitting more packets than the rate limit! Current queue size: ${this.sendQueue.length}`);
        }
        this.ws.send(data);
    }

    public send(tag: string, ...values: any[]): void {
        emitPacket(this.clientPackets, (d) => this.raw_send(d), tag, values);
    }

    public on_ready(listener: () => void): void {
        if (this.pastKeys) listener();
        else this.readyListeners!.push(listener);
    }

    public on_close(listener: (event: CloseEvent) => void): void {
        this.listeners.close.push(listener);
    }

    public on(tag: string, listener: (value: any[]) => void): void {
        if (this.ws.readyState !== WebSocket.OPEN) {
            if (!this.preListen![tag]) this.preListen![tag] = [];
            this.preListen![tag].push(listener);
            return;
        }
        const packet = this.serverPackets.getPacket(tag);
        this.listen(tag, listener);
    }
}