import * as WS from 'ws';
import { SonicWSServer } from './SonicWSServer';

export class SonicWSConnection {
    private socket: WS.WebSocket;
    private host: SonicWSServer;
    private listeners: Record<string, Array<(value: string) => void>>;

    constructor(socket: WS.WebSocket, host: SonicWSServer) {
        this.socket = socket;
        this.host = host;

        this.listeners = {};
        for (const key of Object.values(host.clientKeys.keys)) {
            this.listeners[String.fromCodePoint(key)] = [];
        }

        this.socket.on('message', (data: WS.RawData) => {
            const message = data.toString();

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

            this.listeners[key].forEach(listener => listener(value));
        });
    }

    public on_close(listener: (code: number, reason: Buffer) => void): void {
        this.socket.on('close', listener);
    }

    public raw_send(data: string): void {
        this.socket.send(data);
    }

    public close(): void {
        this.socket.close();
    }

    /** Listens for when the client sends a message. This will use the server's key system */
    public on(key: string, listener: (value: string) => void): void {
        const code = this.host.clientKeys.getChar(key);
        if (code == null) throw new Error(`Key "${key}" has not been created!`);

        if (!this.listeners[code]) this.listeners[code] = [];

        this.listeners[code].push(listener);
    }

    public send(key: string, value: string = "") {
        const code = this.host.serverKeys.getChar(key);
        if(code == null) throw new Error(`Key "${key}" has not been created!`);

        this.socket.send(code + value);
    }

}