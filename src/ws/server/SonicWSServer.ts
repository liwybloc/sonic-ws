/*
 * Copyright 2026 Lily (liwybloc)
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import * as WS from 'ws';
import http from 'http';
import open from 'open';
import { SonicWSConnection } from './SonicWSConnection';
import { PacketHolder } from '../util/packets/PacketHolder';
import { compressGzip, convertVarInt, MAX_BYTE } from '../util/packets/CompressionUtil';
import { SERVER_SUFFIX_NUMS, VERSION } from '../../version';
import { CreatePacket, processPacket } from '../util/packets/PacketUtils';
import { Packet } from '../packets/Packets';
import { PacketType } from '../packets/PacketType';
import { SendQueue } from '../PacketProcessor';
import { setHashFunc } from '../util/packets/HashUtil';

export type SonicServerSettings = {
    /** If it should check for updates; defaults to true. */
    readonly checkForUpdates?: boolean;
    /** If the rereference should use a 64 bit hash which is less prone to collision (1% after ~600 million) or a 32 bit hash. Defaults to true. */
    readonly bit64Hash?: boolean;
};

/**
 * Sonic WS Server Options
 */
export type SonicServerOptions = {
    /** An array of packets the client can send and server can listen for; using CreatePacket(), CreateObjPacket(), and CreateEnumPacket() */
    readonly clientPackets?: PacketTypings,
    /** An array of packets the server can send and client can listen for; using CreatePacket(), CreateObjPacket(), and CreateEnumPacket() */
    readonly serverPackets?: PacketTypings,
    /** Default WS Options */
    readonly websocketOptions?: WS.ServerOptions;
    readonly sonicServerSettings?: SonicServerSettings;
}

export type PacketTypings = readonly Packet<PacketType | readonly PacketType[]>[];

export class SonicWSServer {
    private wss: WS.WebSocketServer;

    private availableIds: number[] = [];
    private lastId: number = 0;
    
    private connectListeners: Array<(client: SonicWSConnection) => void> = [];

    public clientPackets: PacketHolder;
    public serverPackets: PacketHolder;

    connections: SonicWSConnection[] = [];
    private connectionMap: Record<number, SonicWSConnection> = {};

    private clientRateLimit: number = 500;
    private serverRateLimit: number = 500;

    private handshakePacket: string | null = null;

    tags: Map<SonicWSConnection, Set<String>> = new Map();
    tagsInv: Map<String, Set<SonicWSConnection>> = new Map();

    private serverwideSendQueue: SendQueue = [false, [], undefined];

    /**
     * Initializes and hosts a websocket with sonic protocol
     * Rate limits can be set with wss.setClientRateLimit(x) and wss.setServerRateLimit(x); it is defaulted at 500/second per both
     * @param settings Sonic Server Options such as schema data for client and server packets, alongside websocket options
     */ 
    constructor(settings: SonicServerOptions) {
        const { clientPackets = [], serverPackets = [], websocketOptions = {} } = settings;
 
        this.wss = new WS.WebSocketServer(websocketOptions);

        this.clientPackets = new PacketHolder(clientPackets);
        this.serverPackets = new PacketHolder(serverPackets);

        const s_clientPackets = this.clientPackets.serialize();
        const s_serverPackets = this.serverPackets.serialize();

        const serverData = [...SERVER_SUFFIX_NUMS, VERSION];
        const keyData: number[] = [...convertVarInt(s_clientPackets.length), ...s_clientPackets, ...s_serverPackets];

        setHashFunc(settings.sonicServerSettings?.bit64Hash ?? true);

        this.wss.on('connection', async (socket) => {
            const sonicConnection = new SonicWSConnection(socket, this, this.generateSocketID(), this.handshakePacket, this.clientRateLimit, this.serverRateLimit);

            // send tags to the client so it doesn't have to hard code them in
            const data = new Uint8Array([...convertVarInt(sonicConnection.id), ...keyData]);
            socket.send([...serverData, ...await compressGzip(data)]);

            this.connections.push(sonicConnection);
            this.connectionMap[sonicConnection.id] = sonicConnection;
            this.connectListeners.forEach(l => l(sonicConnection));

            socket.on('close', () => {
                this.connections.splice(this.connections.indexOf(sonicConnection), 1);
                delete this.connectionMap[sonicConnection.id];
                this.availableIds.push(sonicConnection.id);
                if(this.tags.has(sonicConnection)) {
                    for(const tag of this.tags.get(sonicConnection)!) this.tagsInv.get(tag)?.delete(sonicConnection);
                    this.tags.delete(sonicConnection);
                }
            });
        });

        if(settings.sonicServerSettings?.checkForUpdates ?? true) {
            fetch('https://raw.githubusercontent.com/liwybloc/sonic-ws/refs/heads/main/release/version')
                .then((res: Response) => res.text())
                .then((ver: string) => {
                    if(parseInt(ver) > VERSION) {
                        console.warn(`SonicWS is currently running outdated! (current: ${VERSION}, latest: ${ver}) Update with "npm update sonic-ws"`)
                    }
                })
                .catch((err: Error) => {
                    console.error(err);
                    console.warn(`Could not check SonicWS version.`);
                });
        }
    }

    private generateSocketID(): number {
        if(this.availableIds.length == 0) this.availableIds.push(this.lastId + 1);
        this.lastId = this.availableIds.shift()!;
        return this.lastId;
    }
    
    /**
     * Requires each client to send this packet upon initialization
     * 
     * Recreates this:
     * ```js
     * let initiated = false;
     * socket.on('init', () => {
     *  if(initiated) return socket.close();
     *  initiated = true;
     *  // process
     * });
     * 
     * socket.on('otherPacket', () => {
     *  if(!initiated) return socket.close();
     *  // process
     * })
     * ```
     * 
     * @param packet The tag of the packet to require as a handshake
     */
    public requireHandshake(packet: string) {
        if(!this.clientPackets.hasTag(packet)) throw new Error(`The client does not send "${packet}" and so it cannot use it as a handshake!`);
        if(this.clientPackets.getPacket(packet).dataBatching != 0) throw new Error(`The packet "${packet}" is a batched packet, and cannot be used as a handshake!`);
        this.handshakePacket = packet;
    }

    /**
     * Sets the rate limit for all client-side packets
     * @param limit Amount of packets the sockets can send every second, or 0 for infinite
     */
    public setClientRateLimit(limit: number) {
        // so that i can store limits in 1 packet
        if(limit > MAX_BYTE) {
            limit = 0;
            console.warn(`A rate limit above ${MAX_BYTE} is considered infinite.`);
        }
        this.clientRateLimit = limit;
    }

    /**
     * Sets the rate limit for server-side packets per-socket
     * @param limit Amount of packets the server can send every second, or 0 for infinite
     */
    public setServerRateLimit(limit: number) {
        // so that i can store limits in 1 packet
        if(limit > MAX_BYTE) {
            limit = 0;
            console.warn(`A rate limit above ${MAX_BYTE} is considered infinite.`);
        }
        this.serverRateLimit = limit;
    }

    /**
     * Enables a packet for all current & new clients.
     * @param tag The tag of the packet
     */
    public enablePacket(tag: string) {
        this.clientPackets.getPacket(tag).defaultEnabled = true;
        this.connections.forEach(socket => socket.enablePacket(tag));
    }

    /**
     * Disables a packet for all current & new clients.
     * @param tag The tag of the packet
     */
    public disablePacket(tag: string) {
        this.clientPackets.getPacket(tag).defaultEnabled = false;
        this.connections.forEach(socket => socket.disablePacket(tag));
    }

    /**
     * Listens for whenever a client connects
     * @param runner Called when ready
     */
    public on_connect(runner: (client: SonicWSConnection) => void): void {
        this.connectListeners.push(runner);
    }

    /**
     * Listens for whenever the server is ready
     * @param runner Called when ready
     */
    public on_ready(runner: () => void): void {
        this.wss.on('listening', runner);
    }

    /**
     * Closes the server
     * @param callback Called when server closes
     */
    public shutdown(callback: (err?: Error) => void): void {
        this.wss.close(callback);
    }

    /**
     * Broadcasts a packet to tagged users; this is fast as it is a record rather than looping and filtering
     * @param tag The tag to send packets to
     * @param packetTag Packet tag to send
     * @param values Values to send
     */
    public async broadcastTagged(tag: string, packetTag: string, ...values: any): Promise<void> {
        if(!this.tagsInv.has(tag)) return;

        const data = await processPacket(this.serverPackets, packetTag, values, this.serverwideSendQueue, -1);
        this.tagsInv.get(tag)!.forEach(conn => conn.send_processed(...data));
    }

    /**
     * Broadcasts a packet to all users connected, but with a filter
     * @param tag The tag to send
     * @param filter The filter for who to send to
     * @param values The values to send
     */
    public async broadcastFiltered(tag: string, filter: (socket: SonicWSConnection) => boolean, ...values: any): Promise<void> {
        const data = await processPacket(this.serverPackets, tag, values, this.serverwideSendQueue, -1);
        this.connections.filter(filter).forEach(conn => conn.send_processed(...data));
    }

    /**
     * Broadcasts a packet to all users connected
     * @param tag The tag to send
     * @param values The values to send
     */
    public broadcast(tag: string, ...values: any): void {
        this.broadcastFiltered(tag, () => true, ...values);
    }

    /**
     * @returns All users connected to the socket
     */
    public getConnected(): SonicWSConnection[] {
        return this.connections;
    }

    /**
     * @param id The socket id
     * @returns The socket
     */
    public getSocket(id: number): SonicWSConnection {
        return this.connectionMap[id];
    }

    /**
     * Closes a socket by id
     * @param id The socket id
     */
    public closeSocket(id: number, code: number = 1000, reason?: string | Buffer): void {
        this.getSocket(id).close(code, reason);
    }

    /**
     * Tags the socket with a key
     * @param socket The socket to tag
     * @param tag The tag to add
     * @param replace If it should replace a previous tag; defaults to true. If using false, you can add multiple tags.
     */
    public tag(socket: SonicWSConnection, tag: string, replace: boolean = true) {
        if(!this.tags.get(socket)) this.tags.set(socket, new Set());
        if(!this.tagsInv.get(tag)) this.tagsInv.set(tag, new Set());
        if(replace) {
            this.tags.get(socket)!.forEach(v => this.tagsInv.get(v)?.delete(socket));
        }
        this.tags.get(socket)!.add(tag);
        this.tagsInv.get(tag)!.add(socket);
    }

    private debugServer: http.Server | null = null;
    private debugSocket: SonicWSServer | null = null;

    /**
     * Opens a debug menu; this launches the browser and starts a subserver
     * @param port Port of the server/http, defaults to 0 which finds an open port
     */
    public OpenDebug(port: number = 0) {
        if (this.debugServer != null) throw new Error("Attempted to open a debug server when one has already been opened.");
        if (port < 0 || port >= 65536) throw new Error("Port out of range!");

const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    const html = String.raw;
    res.end(html`
        <html>
        <head>
            <script src="https://cdn.jsdelivr.net/gh/liwybloc/sonic-ws/bundled/SonicWS_bundle.js"></script>
            <style>
                body {
                    margin: 0;
                    font-family: Arial, sans-serif;
                    background-color: #121212;
                    color: #ffffff;
                    height: 100vh;
                    display: flex;
                    flex-direction: column;
                }
                header {
                    background-color: #1f1f1f;
                    padding: 20px;
                    text-align: center;
                    font-size: 24px;
                    font-weight: bold;
                    box-shadow: 0 2px 5px rgba(0, 0, 0, 0.5);
                }
                #tabs {
                    display: flex;
                    background-color: #2a2a2a;
                    padding: 0 10px;
                    box-shadow: inset 0 -1px 0 #444;
                    gap: 5px;
                }
                .tab {
                    padding: 10px 20px;
                    cursor: pointer;
                    border-radius: 8px 8px 0 0;
                    background-color: #2a2a2a;
                    border: 1px solid #444;
                    border-bottom: none;
                    transition: background-color 0.2s;
                }
                .tab.active {
                    background-color: #1f1f1f;
                    border-color: #00aaff;
                }
                #tab-contents {
                    flex: 1;
                    display: flex;
                    flex-direction: column;
                    overflow-y: auto;
                }
                .tab-content {
                    display: none;
                    padding: 20px;
                    color: #cccccc;
                    flex: 1;
                }
                .tab-content.active {
                    display: block;
                }
            </style>
        </head>
        <body>
            <header>SWS Debug Panel</header>
            <div id="tabs"></div>
            <div id="tab-contents"></div>

            <script>
                const tabsContainer = document.getElementById('tabs');
                const contentsContainer = document.getElementById('tab-contents');
                const tabs = new Map();

                function addTab(id, title, contentHTML) {
                    const tab = document.createElement('div');
                    tab.className = 'tab';
                    tab.textContent = title;
                    tab.dataset.id = id;

                    const content = document.createElement('div');
                    content.className = 'tab-content';
                    content.innerHTML = contentHTML;

                    tabs.set(id, { tab, content });

                    tabsContainer.appendChild(tab);
                    contentsContainer.appendChild(content);

                    if (tabs.size === 1) setActiveTab(id);

                    tab.addEventListener('click', () => setActiveTab(id));
                }

                function setActiveTab(id) {
                    tabs.forEach(({ tab, content }) => {
                        if (tab.dataset.id === id) {
                            tab.classList.add('active');
                            content.classList.add('active');
                        } else {
                            tab.classList.remove('active');
                            content.classList.remove('active');
                        }
                    });
                }

                addTab('home', 'Home', '<p>Welcome to the SonicWS debug menu!</p><br><p>Sockets that connect to the server will show up here.</p>');

                const socket = new SonicWS('ws://' + window.location.host);
            </script>
        </body>
        </html>
    `);
});

        server.listen(port, () => {
            const address = server.address() as WS.AddressInfo;
            console.log(`SWS Debug server running at http://localhost:${address.port}`);
            open(`http://localhost:${address.port}`);
        });

        this.debugSocket = new SonicWSServer({
            clientPackets: [],
            serverPackets: [
                CreatePacket({ tag: "connection", type: PacketType.UVARINT }),
            ],
            websocketOptions: { server },
        });

        this.debugServer = server;
    }

}