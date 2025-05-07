import * as WS from 'ws';

export class SonicWS {
    private ws: WS.WebSocket;
    private key: number;
    public keys: Record<string, number>;

    private listeners: {
        message: Array<(data: string) => void>,
        close: Array<(event: CloseEvent) => void>
        event: {[key: string]: Array<(key: string) => void>}
    };

    constructor(url: string, options?: WS.ClientOptions) {
        this.ws = new WS.WebSocket(url, options);

        this.key = ' '.codePointAt(0)!;
        this.keys = {};

        this.listeners = {
            message: [],
            close: [],
            event: {},
        };

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

    /** Creates a key; remember to keep keys created in the same order as the server */
    public createKey(tag: string): void {
        this.key++;
        this.keys[tag] = this.key;
        this.listeners.event[this.key] = [];
    }
    /** Creates multiple keys; remember to keep keys created in the same order as the server */
    public createKeys(...tags: string[]): void {
        for (const tag of tags) this.createKey(tag);
    }

    public send(key: string, value: string): void {
        const code = this.keys[key];
        if (code === undefined) throw new Error(`Key "${key}" has not been created!`);

        this.ws.send(String.fromCodePoint(code) + value);
    }

    public on_ready(listener: () => void): void {
        this.ws.on('open', listener);
    }

    public on(key: string, listener: (value: string) => void) {
        this.listeners.event[this.keys[key]].push(listener);
    }

}