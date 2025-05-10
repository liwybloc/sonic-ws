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
    
    /** The index of the connection. Alternative, check `this.code` for a low bandwidth usage. */
    public id: number;
    /** The indexed character of the connection. Smaller data packet in strings. */
    public code: string;

    constructor(socket: WS.WebSocket, host: SonicWSServer, id: number) {
        this.socket = socket;
        this.host = host;
        this.id = id;
        this.code = String.fromCharCode(id);

        this.listeners = {};
        for (const key of Object.values(host.clientPackets.getKeys())) {
            this.listeners[String.fromCharCode(key)] = [];
        }

        this.socket.on('message', (data: WS.RawData) => {

            const message = data.toString();

            if(this.print) console.log(`\x1b[31m⬇ \x1b[38;5;245m(${this.id},${getStringBytes(message)})\x1b[0m ${message}`);

            if (message.length < 1) {
                this.socket.close(4001);
                return;
            }

            const key = message[0];
            const value = message.substring(1);

            // not a key, bye bye
            if(!this.host.clientPackets.has(key)) {
                this.socket.close(4002);
                return;
            }

            for(const listener of this.listeners[key]) {
                const valid = listener.listen(value);
                // if invalid then ignore it
                if(!valid) {
                    socket.close(4003);
                    break;
                }
            };
        });
    }

    public on_close(listener: (code: number, reason: Buffer) => void): void {
        this.socket.on('close', listener);
    }

    public raw_send(data: string): void {
        if(this.print) console.log(`\x1b[32m⬆ \x1b[38;5;245m(${this.id},${getStringBytes(data)})\x1b[0m ${data}`);
        this.socket.send(data);
    }

    public close(): void {
        this.socket.close(1000);
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

        if (!this.listeners[code]) this.listeners[code] = [];

        this.listeners[code].push(new PacketListener(packet, listener));
    }

    public send(tag: string, ...values: any[]) {
        emitPacket(this.host.serverPackets, (d) => this.raw_send(d), tag, values);
    }

    /** Toggles printing all sent and received messages */
    public togglePrint(): void {
        this.print = !this.print;
    }

    public broadcast(tag: string, ...values: any[]) {
        this.host.getConnected().forEach(conn => conn != this && conn.send(tag, ...values));
    }

}