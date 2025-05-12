import * as WS from 'ws';
import { SonicWSServer } from './SonicWSServer';
import { PacketListener } from '../packets/PacketListener';
import { getStringBytes } from '../util/CodePointUtil';
import { emitPacket } from '../util/PacketUtils';

export class SonicWSConnection {
    private socket: WS.WebSocket;
    private host: SonicWSServer;

    private listeners: Record<string, Array<PacketListener>>;

    private print: boolean = false;

    private rateLimitInterval: number;
    private rateLimit: number = 50;
    private received: number = 0;

    private timers: number[] = [];
    
    private handshakePacket: string | null;
    private handshakeLambda!: (data: WS.MessageEvent) => void;

    private messageLambda = (data: WS.MessageEvent) => this.messageHandler(this.parseData(data));
    private handshakedMessageLambda = (data: WS.MessageEvent) => {
        const parsed = this.parseData(data);
        if(parsed == null) return;
        if(parsed[0] == this.handshakePacket) return this.socket.close(4005);
        this.messageHandler(parsed);
    }

    /** If the packet handshake has been completed; `wss.requireHandshake(packet)` */
    public handshakeComplete: boolean = false;
    
    /** The index of the connection. Alternatively, check `this.code` for a low bandwidth character. */
    public id: number;
    /** The indexed character of the connection. Smaller data packet in strings. */
    public code: string;

    constructor(socket: WS.WebSocket, host: SonicWSServer, id: number, handshakePacket: string | null) {
        this.socket = socket;
        this.host = host;

        this.id = id;
        this.code = String.fromCharCode(id);
        
        this.handshakePacket = handshakePacket;

        this.listeners = {};
        for (const key of Object.values(host.clientPackets.getTags())) {
            this.listeners[key] = [];
        }

        if(this.handshakePacket == null) {
            this.socket.addEventListener('message', this.messageLambda);
        } else {
            this.handshakeLambda = (data: WS.MessageEvent) => this.handshakeHandler(data);
            this.socket.addEventListener('message', this.handshakeLambda);
        }

        this.socket.on('close', () => {
            clearInterval(this.rateLimitInterval);
            this.timers.forEach(clearTimeout);
        });

        this.rateLimitInterval = setInterval(() => this.received = 0, 1000) as unknown as number;
    }

    private parseData(data: WS.MessageEvent): [key: string, value: string] | null {
        if(++this.received > this.rateLimit) {
            this.socket.close(4000);
            return null;
        }

        const message = data.data.toString();

        if(this.print) console.log(`\x1b[31m⬇ \x1b[38;5;245m(${this.id},${getStringBytes(message)})\x1b[0m ${this.hideNewLines(message)}`);

        if (message.length < 1) {
            this.socket.close(4001);
            return null;
        }

        const key = message[0];
        const value = message.substring(1);

        // not a key, bye bye
        if(!this.host.clientPackets.has(key)) {
            this.socket.close(4002);
            return null;
        }

        return [this.host.clientPackets.getTag(key), value];
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

    private messageHandler(data: [tag: string, value: string] | null): void {
        if(data == null) return;

        const [tag, value] = data;
        for(const listener of this.listeners[tag]) {
            const valid = listener.listen(value);
            // if invalid then ignore it
            if(!valid) {
                this.socket.close(4003);
                break;
            }
        };
    }

    private hideNewLines(str: string): string {
        return str.split("\n").join("☺");
    }

    /** Sends raw data to the user; will likely fail validity checks if used externally */
    public raw_send(data: string): void {
        if(this.isClosed()) throw new Error("Connection is already closed!");
        if(this.print) console.log(`\x1b[32m⬆ \x1b[38;5;245m(${this.id},${getStringBytes(data)})\x1b[0m ${this.hideNewLines(data)}`);
        this.socket.send(data);
    }

    /**
     * Checks if the connection is closed
     * @returns If it's closed or not
     */
    public isClosed(): boolean {
        return this.socket.readyState == WS.CLOSED;
    }

    /**
     * Sets the rate limit of the client
     * @param limit How many packets can be sent every second
     */
    public setRateLimit(limit: number): void {
        this.rateLimit = limit;
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
        const code = this.host.clientPackets.getChar(tag);
        if (code == null) throw new Error(`Tag "${tag}" has not been created!`);
        const packet = this.host.clientPackets.getPacket(tag);

        if (!this.listeners[tag]) this.listeners[tag] = [];

        this.listeners[tag].push(new PacketListener(packet, listener));
    }

    /**
     * Sends a packet with the tag and values
     * @param tag The tag to send
     * @param values The values to send
     */
    public send(tag: string, ...values: any[]) {
        emitPacket(this.host.serverPackets, (d) => this.raw_send(d), tag, values);
    }

    /**
     * Broadcasts a packet to all other users connected
     * @param tag The tag to send
     * @param values The values to send
     */
    public broadcast(tag: string, ...values: any[]) {
        this.host.getConnected().forEach(conn => conn != this && conn.send(tag, ...values));
    }

    /**
     * Toggles printing all sent and received messages
     */
    public togglePrint(): void {
        this.print = !this.print;
    }

    /**
     * Closes the socket
     */
    public close(): void {
        this.socket.close(1000);
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