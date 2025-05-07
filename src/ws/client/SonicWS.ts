import * as WS from 'ws';
import { KeyHolder } from '../KeyHolder';

export class SonicWS {
    private ws: WS.WebSocket;

    private listeners: {
        message: Array<(data: string) => void>,
        close: Array<(event: CloseEvent) => void>
        event: {[key: string]: Array<(key: string) => void>}
    };

    private preListen: {[key: string]: Array<(key: string) => void>};

    private clientKeys: KeyHolder;
    private serverKeys: KeyHolder;

    constructor(url: string, options?: WS.ClientOptions) {
        this.ws = new WS.WebSocket(url, options);

        this.listeners = {
            message: [],
            close: [],
            event: {},
        };

        this.preListen = {};

        this.clientKeys = new KeyHolder([]);
        this.serverKeys = new KeyHolder([]);

        this.ws.on('upgrade', (req) => {
            const headers = req.headers;
            const ckData = headers['s-clientkeys'], skData = headers['s-serverkeys'];
            if(!ckData || !skData || typeof ckData != 'string' || typeof skData != 'string') {
                this.ws.close();
                console.error("The server requested is not a Sonic WS server.");
                return;
            }

            this.clientKeys.createKeys(ckData.split(","));
            this.serverKeys.createKeys(skData.split(","));

            Object.keys(this.preListen).forEach(key => this.preListen[key].forEach(l => this.listen(key, l)));
        });

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

    private listen(key: string, listener: (value: string) => void) {
        const skey = this.serverKeys.get(key);
        if(!skey) {
            console.log("Key is not available on server: " + skey);
            return;
        }

        if(!this.listeners.event[skey]) this.listeners.event[skey] = [];
        this.listeners.event[skey].push(listener);
    }

    public raw_onmessage(listener: (data: string) => void): void {
        this.listeners.message.push(listener);
    }

    public send(key: string, value: string): void {
        const code = this.clientKeys.getChar(key);
        if (code == null) throw new Error(`Key "${key}" has not been created!`);

        this.ws.send(code + value);
    }

    public on_ready(listener: () => void): void {
        this.ws.on('open', listener);
    }
    public on_close(listener: (event: CloseEvent) => void): void {
        this.ws.on('close', listener);
    }

    public on(key: string, listener: (value: string) => void) {
        if(this.ws.readyState != this.ws.OPEN) {
            if(!this.preListen[key]) this.preListen[key] = [];
            this.preListen[key].push(listener);
            return;
        }
        this.listen(key, listener);
    }

}