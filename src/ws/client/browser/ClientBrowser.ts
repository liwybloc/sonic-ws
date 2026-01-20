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

import { ConnectionMiddleware } from "../../PacketProcessor";
import { WrapEnum, DeWrapEnum } from "../../util/enums/EnumHandler";
import { FlattenData, UnFlattenData } from "../../util/packets/PacketUtils";
import { SonicWSCore } from "../core/ClientCore";

// Defines SonicWS class in the browser and gives delegation of functions
// types are here so you can do /** @type */

export class SonicWS extends SonicWSCore {

    private antiTamperCall: () => void = () => { };

    /**
     * Creates a connection to the url
     * @param url The url to connect to
     * @param options The websocket options
     * @param antiTamper Attempts to prevent crude tampering with the socket. Defaults to false.
     */
    constructor(url: string, protocols?: string | string[], antiTamper: boolean = false) {
        const ws = new WebSocket(url, protocols);
        super(ws, async (val: MessageEvent) => new Uint8Array(await (val.data as Blob).arrayBuffer()));

        if (antiTamper) {
            const thiz = this;
            const ogWSSend = ws.send.bind(ws);
            const ogTSSend = this.send.bind(this);
            let lastSend: number;
            this.send = async (tag: string, ...values: any[]) => {
                lastSend = thiz.clientPackets.getKey(tag);
                return await ogTSSend(tag, ...values);
            };
            ws.send = (v) => {
                if (!(v instanceof Uint8Array) || lastSend != v[0]) {
                    thiz.antiTamperCall();
                    thiz.close();
                    return;
                }
                return ogWSSend(v);
            };
        }
    }

    /**
     * If antiTamper is on, this will call when the tamper flag is violated. It will also automatically close the socket for you
     * @param callback 
     */
    on_tamper(callback: () => void) {
        this.antiTamperCall = callback;
    }

    /**
     * Wraps an enum into a transmittable format
     * @param tag The tag of the enum
     * @param value The value to send
     * @returns A transmittable enum value
     */
    WrapEnum(tag: string, value: string) {
        return WrapEnum(tag, value);
    }

    DeWrapEnum(tag: string, value: number) {
        return DeWrapEnum(tag, value);
    }

    /**
     * Flattens a 2-depth array for efficient wire transfer
     * Turns [[x,y,z],[x,y,z]...] to [[x,x...],[y,y...],[z,z...]]
     * @param array A 2-depth array of multi-valued
     */
    FlattenData(array: any[][]): any[] {
        return FlattenData(array);
    }

    /**
     * Unflattens an array into 2-depth; reverse of FlattenData()
     * turns [[x,x...],[y,y...],[z,z...]] to [[x,y,z],[x,y,z]...]
     * @param array A flattened array
     */
    UnFlattenData(array: any[]): any[][] {
        return UnFlattenData(array);
    }

    /**
     * Creates a debug menu that shows information about the connection and packets.
     */
    OpenDebug() {
    //     const html = String.raw;
    //     const debugHTML = html`
    // <style>
    //     sws-h3 {
    //         margin: 0;
    //         color: #fff;
    //         font-size: 16px;
    //         font-weight: 600;
    //     }

    //     #sonicws-container {
    //         display: flex;
    //         flex-direction: column;
    //         position: absolute;
    //         top: 50px;
    //         left: 50px;
    //         width: 75vw;
    //         min-width: 33vw;
    //         min-height: 25vh;
    //         max-height: 75vh;
    //         max-width: 75vw;
    //         font-family: Arial, sans-serif;
    //         background-color: #2c2c2c;
    //         border-radius: 10px;
    //         box-shadow: 0 8px 20px rgba(0,0,0,0.4);
    //         overflow: hidden;
    //         user-select: none;
    //         transition: box-shadow 0.2s ease;
    //         z-index: 2147483647;
    //     }

    //     #sonicws-container:hover {
    //         box-shadow: 0 12px 28px rgba(0,0,0,0.6);
    //     }

    //     #sonicws-header {
    //         display: flex;
    //         justify-content: space-between;
    //         align-items: center;
    //         cursor: move;
    //         background: linear-gradient(90deg, #4a90e2, #357ab7);
    //         padding: 10px 12px;
    //         border-top-left-radius: 10px;
    //         border-top-right-radius: 10px;
    //     }

    //     #sonicws-toggle {
    //         font-size: 18px;
    //         font-weight: bold;
    //         cursor: pointer;
    //         color: #fff;
    //         user-select: none;
    //     }

    //     #sonicws-body {
    //         flex: 1;
    //         display: flex;
    //         padding: 12px;
    //         color: #e0e0e0;
    //         font-size: 14px;
    //         min-height: 0;
    //     }

    //     #sonicws-stats {
    //         display: flex;
    //         flex-direction: column;
    //         min-width: 140px;
    //     }

    //     #sonicws-stats sws-p {
    //         margin: 4px 0;
    //     }

    //     #sonicws-packets {
    //         min-height: 0;
    //         display: flex;
    //         flex-direction: column;
    //         flex: 1;
    //         margin-left: 10px;
    //         background-color: #1e1e1e;
    //         padding: 8px;
    //         border-radius: 8px;
    //         overflow-y: scroll;
    //     }

    //     sws-div.packet {
    //         background-color: #2a2a2a;
    //         border-radius: 6px;
    //         padding: 3px 5px;
    //         margin-bottom: 2px;
    //         cursor: pointer;
    //         transition: background 0.2s ease, transform 0.1s ease;
    //         display: flex;
    //         flex-direction: column;
    //     }

    //     sws-div.packet:hover {
    //         background-color: #3a3a3a;
    //         transform: translateY(-1px);
    //     }

    //     sws-div.packet-header {
    //         display: flex;
    //         align-items: flex-start;
    //         flex-wrap: wrap;
    //         font-size: 11px;
    //         white-space: normal;
    //         word-break: break-word;
    //     }

    //     sws-span.packet-arrow {
    //         font-weight: bold;
    //         margin-right: 6px;
    //     }

    //     sws-div.packet-details {
    //         margin-top: 6px;
    //         font-size: 10px;
    //         color: #aaa;
    //         display: none;
    //         flex-direction: column;
    //     }

    //     sws-div.packet.expanded sws-div.packet-details {
    //         display: flex;
    //     }

    //     #sonicws-resizer {
    //         width: 12px;
    //         height: 12px;
    //         background: #666;
    //         position: absolute;
    //         right: 0;
    //         bottom: 0;
    //         cursor: se-resize;
    //         border-bottom-right-radius: 10px;
    //         transition: background 0.2s ease;
    //     }

    //     #sonicws-resizer:hover {
    //         background: #888;
    //     }

    //     #sonicws-container.minimized {
    //         width: auto !important;
    //         height: auto !important;
    //         min-width: unset;
    //         min-height: unset;
    //     }

    //     #sonicws-container.minimized #sonicws-body,
    //     #sonicws-container.minimized #sonicws-resizer {
    //         display: none;
    //     }

    //     #sonicws-container.minimized #sonicws-header {
    //         padding: 8px 12px;
    //     }

    //     #sonicws-container.minimized #sonicws-title {
    //         font-size: 14px;
    //     }
    // </style>

    // <sws-div id="sonicws-container">
    //     <sws-div id="sonicws-header">
    //         <sws-h3 id="sonicws-title">SonicWS Debug Menu</sws-h3>
    //         <sws-span id="sonicws-toggle">−</sws-span>
    //     </sws-div>
    //     <sws-div id="sonicws-body">
    //         <sws-div id="sonicws-stats">
    //             <sws-p>Status: <sws-span id="sonicws-status">Connecting</sws-span></sws-p>
    //             <sws-p>Sent Packets: <sws-span id="sonicws-sent">0</sws-span></sws-p>
    //             <sws-p>Received Packets: <sws-span id="sonicws-received">0</sws-span></sws-p>
    //             <sws-p>Total Bytes Sent: <sws-span id="sonicws-sentbytes">0</sws-span></sws-p>
    //             <sws-p>Total Bytes Received: <sws-span id="sonicws-receivedbytes">0</sws-span></sws-p>
    //             <sws-p>Total Bytes Saved: <sws-span id="sonicws-savedbytes">0</sws-span></sws-p>
    //         </sws-div>
    //         <sws-div id="sonicws-packets"></sws-div>
    //     </sws-div>
    //     <sws-div id="sonicws-resizer"></sws-div>
    // </sws-div>`;
        const debugHTML = `<style>sws-h3{margin:0;color:#fff;font-size:16px;font-weight:600}#sonicws-container{display:flex;flex-direction:column;position:absolute;top:50px;left:50px;width:75vw;min-width:33vw;min-height:25vh;max-height:75vh;max-width:75vw;font-family:Arial,sans-serif;background-color:#2c2c2c;border-radius:10px;box-shadow:0 8px 20px rgba(0,0,0,.4);overflow:hidden;user-select:none;transition:box-shadow .2s ease;z-index:2147483647}#sonicws-container:hover{box-shadow:0 12px 28px rgba(0,0,0,.6)}#sonicws-header{display:flex;justify-content:space-between;align-items:center;cursor:move;background:linear-gradient(90deg,#4a90e2,#357ab7);padding:10px 12px;border-top-left-radius:10px;border-top-right-radius:10px}#sonicws-toggle{font-size:18px;font-weight:700;cursor:pointer;color:#fff;user-select:none}#sonicws-body{flex:1;display:flex;padding:12px;color:#e0e0e0;font-size:14px;min-height:0}#sonicws-stats{display:flex;flex-direction:column;min-width:140px}#sonicws-stats sws-p{margin:4px 0}#sonicws-packets{min-height:0;display:flex;flex-direction:column;flex:1;margin-left:10px;background-color:#1e1e1e;padding:8px;border-radius:8px;overflow-y:scroll}sws-div.packet{background-color:#2a2a2a;border-radius:6px;padding:3px 5px;margin-bottom:2px;cursor:pointer;transition:background .2s ease,transform .1s ease;display:flex;flex-direction:column}sws-div.packet:hover{background-color:#3a3a3a;transform:translateY(-1px)}sws-div.packet-header{display:flex;align-items:flex-start;flex-wrap:wrap;font-size:11px;white-space:normal;word-break:break-word}sws-span.packet-arrow{font-weight:700;margin-right:6px}sws-div.packet-details{margin-top:6px;font-size:10px;color:#aaa;display:none;flex-direction:column}sws-div.packet.expanded sws-div.packet-details{display:flex}#sonicws-resizer{width:12px;height:12px;background:#666;position:absolute;right:0;bottom:0;cursor:se-resize;border-bottom-right-radius:10px;transition:background .2s ease}#sonicws-resizer:hover{background:#888}#sonicws-container.minimized{width:auto!important;height:auto!important;min-width:unset;min-height:unset}#sonicws-container.minimized #sonicws-body,#sonicws-container.minimized #sonicws-resizer{display:none}#sonicws-container.minimized #sonicws-header{padding:8px 12px}#sonicws-container.minimized #sonicws-title{font-size:14px}</style><sws-div id=sonicws-container><sws-div id=sonicws-header><sws-h3 id=sonicws-title>SonicWS Debug Menu</sws-h3><sws-span id=sonicws-toggle>−</sws-span></sws-div><sws-div id=sonicws-body><sws-div id=sonicws-stats><sws-p>Status:<sws-span id=sonicws-status>Connecting</sws-span></sws-p><sws-p>Sent Packets:<sws-span id=sonicws-sent>0</sws-span></sws-p><sws-p>Received Packets:<sws-span id=sonicws-received>0</sws-span></sws-p><sws-p>Total Bytes Sent:<sws-span id=sonicws-sentbytes>0</sws-span></sws-p><sws-p>Total Bytes Received:<sws-span id=sonicws-receivedbytes>0</sws-span></sws-p><sws-p>Total Bytes Saved:<sws-span id=sonicws-savedbytes>0</sws-span></sws-p></sws-div><sws-div id=sonicws-packets></sws-div></sws-div><sws-div id=sonicws-resizer></sws-div></sws-div>`;
    
        const SWS = document.createElement("sonicws");
        SWS.innerHTML = debugHTML;
        if(!document.body) {
            document.addEventListener("DOMContentLoaded", () => {
                document.body.appendChild(SWS);
                this._loadDebugScript();
            });
            return;
        }
        document.body.appendChild(SWS);
        this._loadDebugScript();
    }

    private _evalInScope(code: string) {
        const thiz = this;
        const fn = new Function(
            "send",
            "WrapEnum",
            "DeWrapEnum",
            "FlattenData",
            "UnFlattenData",
            `"use strict"; return (${code});`
        );
        return fn(
            thiz.send.bind(thiz),
            thiz.WrapEnum.bind(thiz),
            thiz.DeWrapEnum.bind(thiz),
            thiz.FlattenData.bind(thiz),
            thiz.UnFlattenData.bind(thiz)
        );
    }

    private _loadDebugScript() {

        const packetsSend: Record<string, [any[], number][]> = {};
        const packetsRecv: Record<string, [Uint8Array, number][]> = {};
        const thiz = this;

        this.addMiddleware(new (class implements ConnectionMiddleware {
            onReceive_pre(tag: string, data: Uint8Array): boolean | void {
                packetsRecv[tag] ??= [];
                packetsRecv[tag].push([data, performance.now()]);
            }
            onReceive_post(tag: string, values: any[]): boolean | void {
                const [data, time] = packetsRecv[tag].shift()!;
                addPacket('received', `${tag} (0x${thiz.serverPackets.getKey(tag).toString(16).toUpperCase()})`, data, JSON.stringify(values), performance.now() - time);
            }

            onSend_pre(tag: string, values: any[]): boolean | void {
                packetsSend[tag] ??= [];
                packetsSend[tag].push([values, performance.now()]);
            }
            onSend_post(tag: string, data: Uint8Array): boolean | void {
                const [values, time] = packetsSend[tag].shift()!;
                addPacket('sent', `${tag} (0x${thiz.clientPackets.getKey(tag).toString(16).toUpperCase()})`, data, JSON.stringify(values), performance.now() - time);
            }

            onStatusChange(status: number): void {
                setStatus(status);
            }
        })());

        const $ = (id: string) => document.getElementById(id)!;

        const container = $('sonicws-container');
        const header = $('sonicws-header');
        const resizer = $('sonicws-resizer');
        const statusEl = $('sonicws-status');
        const packetsDiv = $('sonicws-packets');

        const p_sent = $('sonicws-sent');
        const p_recv = $('sonicws-received');
        const p_sent_bytes = $('sonicws-sentbytes');
        const p_recv_bytes = $('sonicws-receivedbytes');
        const p_saved_bytes = $('sonicws-savedbytes');

        const toggle = document.getElementById('sonicws-toggle')!;
        const title = document.getElementById('sonicws-title')!;

        let minimized = false;

        const evalInput = document.createElement("input");
        evalInput.type = "text";
        evalInput.placeholder = 'send("tag", 5)';
        evalInput.style.marginTop = "8px";
        evalInput.style.width = "100%";
        evalInput.style.boxSizing = "border-box";

        const evalButton = document.createElement("button");
        evalButton.innerText = "Run";
        evalButton.style.marginTop = "4px";
        evalButton.style.width = "100%";

        $('sonicws-stats').appendChild(evalInput);
        $('sonicws-stats').appendChild(evalButton);

        evalButton.addEventListener("click", () => {
            try {
                thiz._evalInScope(evalInput.value);
            } catch (e) {
                console.error(e);
            }
        });

        function clampToViewport() {
            const rect = container.getBoundingClientRect();

            const maxLeft = window.innerWidth - rect.width;
            const maxTop = window.innerHeight - rect.height;

            const left = Math.min(Math.max(0, rect.left), Math.max(0, maxLeft));
            const top = Math.min(Math.max(0, rect.top), Math.max(0, maxTop));

            container.style.left = left + 'px';
            container.style.top = top + 'px';
        }

        toggle.addEventListener('click', e => {
            e.stopPropagation();
            minimized = !minimized;

            if (minimized) {
                container.classList.add('minimized');
                title.innerText = 'SWS';
                toggle.innerText = '+';
                container.style.width = '';
                container.style.height = '';
            } else {
                container.classList.remove('minimized');
                title.innerText = 'SonicWS Debug Menu';
                toggle.innerText = '−';
            }

            clampToViewport();
        });

        type StatsKeys = 
            | 'sonicws-sent'
            | 'sonicws-received'
            | 'sonicws-sentbytes'
            | 'sonicws-receivedbytes'
            | 'sonicws-savedbytes';

        interface InternalStats {
            sentPackets: number;
            receivedPackets: number;
            totalBytesSent: number;
            totalBytesReceived: number;
            totalBytesSaved: number;
        }

        const internalStats: InternalStats = {
            sentPackets: 0,
            receivedPackets: 0,
            totalBytesSent: 0,
            totalBytesReceived: 0,
            totalBytesSaved: 0,
        };

        const stats: Record<StatsKeys, number> = new Proxy(internalStats as any, {
            get(_, prop: string) {
                switch (prop) {
                    case 'sonicws-sent': return internalStats.sentPackets;
                    case 'sonicws-received': return internalStats.receivedPackets;
                    case 'sonicws-sentbytes': return internalStats.totalBytesSent;
                    case 'sonicws-receivedbytes': return internalStats.totalBytesReceived;
                    case 'sonicws-savedbytes': return internalStats.totalBytesSaved;
                    default: return undefined;
                }
            },
            set(_, prop: string, value: number) {
                switch (prop) {
                    case 'sonicws-sent': {
                        internalStats.sentPackets = value; 
                        p_sent.innerText = value.toLocaleString();
                        return true;
                    }
                    case 'sonicws-received': {
                        internalStats.receivedPackets = value;
                        p_recv.innerText = value.toLocaleString();
                        return true;
                    }
                    case 'sonicws-sentbytes': {
                        internalStats.totalBytesSent = value; 
                        const {amt, unit} = convertBytes(value);
                        p_sent_bytes.innerText = amt + unit;
                        return true;
                    }
                    case 'sonicws-receivedbytes': {
                        internalStats.totalBytesReceived = value;
                        const {amt, unit} = convertBytes(value);
                        p_recv_bytes.innerText = amt + unit;
                        return true;
                    }
                    case 'sonicws-savedbytes': {
                        internalStats.totalBytesSaved = value;
                        const {amt, unit} = convertBytes(value);
                        p_saved_bytes.innerText = amt + unit;
                        return true;
                    }
                    default: return false;
                }
            }
        });

        const convertBytes = (bytes: number) => {
            if (!Number.isFinite(bytes) || bytes < 0) {
                return { amt: 0, unit: "B" };
            }

            const units = ["B", "KB", "MB", "GB", "TB"];
            let value = bytes;
            let index = 0;

            while (value >= 1024 && index < units.length - 1) {
                value /= 1024;
                index++;
            }

            return {
                amt: index == 0 ? value.toString() : value.toFixed(2),
                unit: units[index]
            }
        }

        function setStatus(wsStatus: number) {
            switch(wsStatus) {
                case WebSocket.CLOSED: statusEl.innerText = "Closed"; statusEl.style.color = "#f00"; break;
                case WebSocket.CLOSING: statusEl.innerText = "Closing"; statusEl.style.color = "#fa0"; break;
                case WebSocket.OPEN: statusEl.innerText = "Open"; statusEl.style.color = "#0f0"; break;
                case WebSocket.CONNECTING: statusEl.innerText = "Connecting"; statusEl.style.color = "#ff0"; break;
                default: statusEl.innerText = "Unknown"; statusEl.style.color = "#777"; break;
            }
        }

        setStatus(WebSocket.CONNECTING);

        const textEncoder = new TextEncoder();
        function addPacket(direction: string, tag: string, raw: Uint8Array, data: string, processingTime: number) {
            const now = new Date();
            const bytes = raw.length + (direction == "sent" ? 1 : 0);
            const saved = textEncoder.encode(data).length - bytes + 1;

            const packetEl = document.createElement('sws-div');
            packetEl.classList.add('packet');

            const headerEl = document.createElement('sws-div');
            headerEl.classList.add('packet-header');

            const arrow = document.createElement('sws-span');
            arrow.classList.add('packet-arrow');
            arrow.innerText = direction === 'sent' ? '⬆' : '⬇';
            arrow.style.color = direction === 'sent' ? '#0f0' : '#f00';

            const info = document.createElement('sws-span');
            info.innerText = tag + ": " +data;

            headerEl.appendChild(arrow);
            headerEl.appendChild(info);

            const detailsEl = document.createElement('sws-div');
            detailsEl.classList.add('packet-details');
            detailsEl.innerHTML = `
            <sws-p> Raw Bytes: ${ bytes }b (saved ~${saved}b)</sws-p>
                <sws-p> Processed At: ${ now.toISOString() } </sws-p>
                    <sws-p> Processing Time: <sws-span class="processing-time" > ${ processingTime.toFixed(1) } </sws-span> ms</sws-p>
                            `;

            packetEl.appendChild(headerEl);
            packetEl.appendChild(detailsEl);
            packetsDiv.append(packetEl);

            headerEl.addEventListener('click', () => packetEl.classList.toggle('expanded'));

            if (direction === 'sent') {
                stats['sonicws-sent']++;
                stats['sonicws-sentbytes'] += bytes;
            } else {
                stats['sonicws-received']++;
                stats['sonicws-receivedbytes'] += bytes;
            }
            stats['sonicws-savedbytes'] += saved;
        }

        let isDragging = false, dragStartX = 0, dragStartY = 0, containerStartLeft = 0, containerStartTop = 0;
        let isResizing = false, resizeStartX = 0, resizeStartY = 0, containerStartWidth = 0, containerStartHeight = 0;

        header.addEventListener('mousedown', e => {
            isDragging = true;
            dragStartX = e.clientX;
            dragStartY = e.clientY;
            const rect = container.getBoundingClientRect();
            containerStartLeft = rect.left;
            containerStartTop = rect.top;
            e.preventDefault();
        });

        resizer.addEventListener('mousedown', e => {
            isResizing = true;
            resizeStartX = e.clientX;
            resizeStartY = e.clientY;
            const rect = container.getBoundingClientRect();
            containerStartWidth = rect.width;
            containerStartHeight = rect.height;
            e.preventDefault();
        });

        document.addEventListener('mousemove', e => {
            if (isDragging) {
                container.style.left = containerStartLeft + e.clientX - dragStartX + 'px';
                container.style.top = containerStartTop + e.clientY - dragStartY + 'px';
                clampToViewport();
            }

            if (isResizing && !minimized) {
                container.style.width = containerStartWidth + e.clientX - resizeStartX + 'px';
                container.style.height = containerStartHeight + e.clientY - resizeStartY + 'px';
                clampToViewport();
            }
        });

        document.addEventListener('mouseup', () => {
            isDragging = false;
            isResizing = false;
        });

        clampToViewport();
        window.addEventListener('resize', clampToViewport);
    }

}

(window as any).SonicWS = SonicWS;