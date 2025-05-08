import { KeyHolder } from '../../KeyHolder';
import { PacketSendProcessors, PacketType } from '../../packets/PacketType';
import { PacketListener } from '../../packets/PacketListener';

export abstract class SonicWSCore {
    protected ws: WebSocket;
    protected listeners: {
        message: Array<(data: string) => void>,
        close: Array<(event: CloseEvent) => void>,
        event: { [key: string]: Array<PacketListener> }
    };
    protected preListen: { [key: string]: Array<PacketListener> };
    protected clientKeys: KeyHolder;
    protected serverKeys: KeyHolder;

    constructor(ws: WebSocket) {
        this.ws = ws;
        this.listeners = {
            message: [],
            close: [],
            event: {},
        };
        this.preListen = {};
        this.clientKeys = new KeyHolder([]);
        this.serverKeys = new KeyHolder([]);

        this.ws.addEventListener('message', (event: MessageEvent) => {
            let data = event.data.toString();

            this.listeners.message.forEach(listener => listener(data));
            if (data.length < 1) return;

            const key = data.substring(0, 1);
            const value = data.substring(1);
            const code = key.codePointAt(0);
            if (code != null) {
                this.listeners.event[code]?.forEach(l => l.listen(value));
            }
        });

        this.ws.addEventListener('close', (event: CloseEvent) => {
            this.listeners.close.forEach(listener => listener(event));
        });
    }

    protected _finishInit(headers: Record<string, string | string[] | undefined>) {
        const ckData = headers['s-clientkeys'];
        const skData = headers['s-serverkeys'];

        if (
            typeof ckData !== 'string' ||
            typeof skData !== 'string'
        ) {
            this.ws.close();
            console.error("The server requested is not a Sonic WS server.");
            return;
        }

        this.clientKeys.createKeys(ckData.split(","));
        this.serverKeys.createKeys(skData.split(","));

        Object.keys(this.preListen).forEach(key =>
            this.preListen[key].forEach(listener => this.listen(key, listener))
        );
    }

    protected listen(key: string, listener: PacketListener) {
        const skey = this.serverKeys.get(key);
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
        this.ws.send(data);
    }

    public send(key: string, type: PacketType = PacketType.NONE, ...value: any[]): void {
        const code = this.clientKeys.getChar(key);
        if (code == null) throw new Error(`Key "${key}" has not been created!`);
        this.raw_send(code + PacketSendProcessors[type](...value));
    }

    public on_ready(listener: () => void): void {
        if (this.ws.readyState === WebSocket.OPEN) {
            listener();
        } else {
            this.ws.addEventListener('open', listener);
        }
    }

    public on_close(listener: (event: CloseEvent) => void): void {
        this.listeners.close.push(listener);
        this.ws.addEventListener('close', listener);
    }

    public on(key: string, type: PacketType, listener: (value: string) => void, dontSpread: boolean = false): void {
        const packetListener = new PacketListener(type, listener, -1, dontSpread);
        if (this.ws.readyState !== WebSocket.OPEN) {
            if (!this.preListen[key]) this.preListen[key] = [];
            this.preListen[key].push(packetListener);
            return;
        }
        this.listen(key, packetListener);
    }
}