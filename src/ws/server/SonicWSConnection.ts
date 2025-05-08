import * as WS from 'ws';
import { SonicWSServer } from './SonicWSServer';
import { PacketSendProcessors, PacketType } from '../packets/PacketType';
import { PacketListener } from '../packets/PacketListener';

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
            this.listeners[String.fromCodePoint(key)] = [];
        }

        this.socket.on('message', (data: WS.RawData) => {
            const message = data.toString();

            if(this.print) console.log(`\x1b[31m⬇\x1b[0m ${this.id} ${message}`);

            if (message.length < 1) {
                this.socket.close();
                return;
            }

            const key = message.substring(0, 1);
            const value = message.substring(1);

            if(!this.listeners[key]) {
                this.socket.close();
                return;
            }

            this.listeners[key].forEach(listener => listener.listen(value));
        });
    }

    public on_close(listener: (code: number, reason: Buffer) => void): void {
        this.socket.on('close', listener);
    }

    public raw_send(data: string): void {
        if(this.print) console.log(`\x1b[32m⬆\x1b[0m ${this.id} ${data}`);
        this.socket.send(data);
    }

    public close(): void {
        this.socket.close();
    }

    public on(key: string, type: PacketType, listener: (value: string) => void, dontSpread: boolean = false): void {
        const code = this.host.clientKeys.getChar(key);
        if (code == null) throw new Error(`Key "${key}" has not been created!`);

        if (!this.listeners[code]) this.listeners[code] = [];

        this.listeners[code].push(new PacketListener(type, listener, dontSpread));
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