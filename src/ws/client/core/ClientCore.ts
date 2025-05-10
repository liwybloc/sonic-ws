import { PacketHolder } from '../../KeyHolder';
import { Packet } from '../../packets/PacketType';
import { PacketListener } from '../../packets/PacketListener';
import { NULL } from '../../util/CodePointUtil';
import { emitPacket } from '../../util/PacketUtils';
import { VERSION } from '../../../version';

export abstract class SonicWSCore {
    protected ws: WebSocket;
    protected listeners: {
        message: Array<(data: string) => void>,
        close: Array<(event: CloseEvent) => void>,
        event: { [key: string]: Array<PacketListener> }
    };
    protected preListen: { [key: string]: Array<(value: string) => void> };
    protected clientPackets: PacketHolder = PacketHolder.empty();
    protected serverPackets: PacketHolder = PacketHolder.empty();
    private keyHandler: (event: MessageEvent) => undefined;

    constructor(ws: WebSocket) {
        this.ws = ws;
        this.listeners = {
            message: [],
            close: [],
            event: {},
        };
        this.preListen = {};

        this.keyHandler = event => this.serverKeyHandler(event);
        this.ws.addEventListener('message', this.keyHandler); // lambda to persist 'this'

        this.ws.addEventListener('close', (event: CloseEvent) => {
            this.listeners.close.forEach(listener => listener(event));
        });
    }

    private serverKeyHandler(event: MessageEvent): undefined {
        const data: string = event.data.toString();
        if(!data.startsWith("SWS")) {
            this.ws.close();
            throw new Error("The server requested is not a Sonic WS server.");
        }

        const version = data.charCodeAt(3);
        if(version != VERSION) {
            this.ws.close();
            throw new Error(`Version mismatch: ${version > VERSION ? "client" : "server"} is outdated (server: ${version}, client: ${VERSION})`);              
        }

        const [ckData, skData] = data.substring(4).split(NULL);
        this.clientPackets.createPackets(Packet.deserializeAll(ckData));
        this.serverPackets.createPackets(Packet.deserializeAll(skData));

        Object.keys(this.preListen).forEach(tag => this.preListen[tag].forEach(listener => {
            const packet = this.serverPackets.getPacket(tag);
            const packetListener = new PacketListener(packet, listener);
            this.listen(tag, packetListener);
        }));

        this.ws.removeEventListener('message', this.keyHandler);
        this.ws.addEventListener('message', event => this.messageHandler(event)); // lambda to persist 'this'
    }

    private messageHandler(event: MessageEvent) {
        let data = event.data.toString();

        this.listeners.message.forEach(listener => listener(data));
        if (data.length < 1) return;

        const key = data.substring(0, 1);
        const value = data.substring(1);
        const code = key.charCodeAt(0);
        if (code != null) {
            this.listeners.event[code]?.forEach(l => l.listen(value));
        }
    }

    protected listen(key: string, listener: PacketListener) {
        const skey = this.serverPackets.get(key);
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

    public send(tag: string, ...values: any[]): void {
        emitPacket(this.clientPackets, (d) => this.raw_send(d), tag, ...values);
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
    }

    public on(tag: string, listener: (value: string) => void): void {
        if (this.ws.readyState !== WebSocket.OPEN) {
            if (!this.preListen[tag]) this.preListen[tag] = [];
            this.preListen[tag].push(listener);
            return;
        }
        const packet = this.serverPackets.getPacket(tag);
        const packetListener = new PacketListener(packet, listener);
        this.listen(tag, packetListener);
    }
}