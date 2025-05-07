import * as WS from 'ws';
import { SonicWSServer } from './SonicWSServer';

export class SonicWSClient {
    private socket: WS.WebSocket;
    private host: SonicWSServer;
    private listeners: Record<string, Array<(value: string) => void>>;

    constructor(socket: WS.WebSocket, host: SonicWSServer) {
        this.socket = socket;
        this.host = host;

        this.listeners = {};
        for (const key of Object.values(host.keys)) {
            this.listeners[String.fromCodePoint(key)] = [];
        }

        this.socket.on('message', (data: WS.RawData) => {
            const message = data.toString();
            if (message.length === 0) return;

            const key = message.substring(0, 1);
            const value = message.substring(1);

            this.listeners[key]?.forEach(listener => listener(value));
        });
    }

    public raw_send(data: string): void {
        this.socket.send(data);
    }

    /** Listens for when the client sends a message. This will use the server's key system */
    public on(key: string, listener: (value: string) => void): void {
        const code = this.host.keys[key];
        if (code === undefined) throw new Error(`Key "${key}" has not been created!`);

        const symbol = String.fromCodePoint(code);
        if (!this.listeners[symbol]) this.listeners[symbol] = [];

        this.listeners[symbol].push(listener);
    }

    public send(key: string, value: string) {
        const code = this.host.keys[key];
        if(code === undefined) throw new Error(`Key "${key}" has not been created!`);

        this.socket.send(String.fromCodePoint(code) + value);
    }

}