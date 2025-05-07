import * as WS from 'ws';
import { KeyHolder } from './KeyHolder';

export class SonicWS {
    private ws: WS.WebSocket;

    private listeners: {
        message: Array<(data: string) => void>,
        close: Array<(event: CloseEvent) => void>
        event: {[key: string]: Array<(key: string) => void>}
    };

    public clientKeys: KeyHolder;
    public serverKeys: KeyHolder;

    constructor(url: string, options?: WS.ClientOptions) {
        this.ws = new WS.WebSocket(url, options);

        this.listeners = {
            message: [],
            close: [],
            event: {},
        };

        this.clientKeys = new KeyHolder();
        this.serverKeys = new KeyHolder();

        this.ws.on('message', (data: string) => {
            data = data.toString();
            
            this.listeners.message.forEach(listener => listener(data));

            if(data.length < 1) return;

            const key = data.substring(0, 1);
            const value = data.substring(1);

            this.listeners.event[key.codePointAt(0)!]?.forEach(l => l(value));

        });

        this.ws.on('close', (event: CloseEvent) => {
            this.listeners.close.forEach(listener => listener(event));
        });
    }

    public raw_onmessage(listener: (data: string) => void): void {
        this.listeners.message.push(listener);
    }

    public raw_onclose(listener: (event: CloseEvent) => void): void {
        this.listeners.close.push(listener);
    }

    public send(key: string, value: string): void {
        const code = this.clientKeys.getChar(key);
        if (code == null) throw new Error(`Key "${key}" has not been created!`);

        this.ws.send(code + value);
    }

    public on_ready(listener: () => void): void {
        this.ws.on('open', listener);
    }

    public on(key: string, listener: (value: string) => void) {
        this.listeners.event[this.serverKeys.get(key)].push(listener);
    }

    public createClientKeys(...keys: string[]) {
        this.clientKeys.createKeys(keys);
    }
    public createServerKeys(...keys: string[]) {
        this.serverKeys.createKeys(keys);
        for(const key of keys) {
            this.listeners.event[this.serverKeys.get(key)] = [];
        }
    }

}