import * as WS from 'ws';
import { SonicWSServer } from './SonicWSServer';
import { PacketSendProcessors, PacketType } from '../packets/PacketType';
import { PacketListener } from '../packets/PacketListener';
import { getStringBytes } from '../util/CodePointUtil';

export class SonicWSConnection {
    private socket: WS.WebSocket;
    private host: SonicWSServer;
    private listeners: Record<string, Array<PacketListener>>;
    private print: boolean = false;
    
    public id: number;

    constructor(socket: WS.WebSocket, host: SonicWSServer, id: number) {
        this.socket = socket;
        this.host = host;
        this.id = id;

        this.listeners = {};
        for (const key of Object.values(host.clientKeys.keys)) {
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
            if(!this.host.clientKeys.has(key)) {
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
     * @param key The tag of the key to listen for
     * @param type The type of packet to listen for
     * @param listener A function to listen for it
     * @param dataCap The amount of values that can pass through the function
     * @param dontSpread If the values should be kept in an array instead of spread
     */
    public on(key: string, type: PacketType, listener: (value: string) => void, dataCap: number, dontSpread: boolean = false): void {
        const code = this.host.clientKeys.getChar(key);
        if (code == null) throw new Error(`Key "${key}" has not been created!`);

        if (!this.listeners[code]) this.listeners[code] = [];

        this.listeners[code].push(new PacketListener(type, listener, dataCap, dontSpread));
    }

    public send(key: string, type: PacketType = PacketType.NONE, ...value: any[]) {
        const code = this.host.serverKeys.getChar(key);
        if(code == null) throw new Error(`Key "${key}" has not been created!`);
        
        this.raw_send(code + PacketSendProcessors[type](...value));
    }

    /** Toggles printing all sent and received messages */
    public togglePrint(): void {
        this.print = !this.print;
    }

}