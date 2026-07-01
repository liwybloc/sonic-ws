/*
 * Copyright (c) 2026 Lily (liwybloc)
 *
 * Licensed for personal, non-commercial use only.
 * Commercial use, redistribution, sublicensing, sale, rental, lease,
 * or inclusion in a paid product or service is prohibited without prior
 * written permission from the copyright holder.
 *
 * See the LICENSE file in the project root for the full license terms.
 *
 * License-Identifier: LicenseRef-Lily-Personal-NonCommercial-2026
 */

import { CloseCodes, getClosureCause } from "../Connection";
import { ServerMiddleware, ConnectionMiddleware, BCInfo } from "../PacketProcessor";
import { PacketType } from "../packets/PacketType";
import { SonicWSConnection } from "../server/SonicWSConnection";
import { SonicWSServer } from "../server/SonicWSServer";
import { CreateObjPacket, CreatePacket } from "../util/packets/PacketUtils";
import http from 'http';
import { AddressInfo } from "ws";
import open from 'open';
import { DefineEnum } from "../util/enums/EnumHandler";

export class DebugServer {
    constructor(host: SonicWSServer, data: {port?: number, password?: string}) {
        data.port ??= 0;
        data.password ??= "";
        if (data.port < 0 || data.port >= 65536) throw new Error("Port out of range!");

/*
 * `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <script src="https://cdn.jsdelivr.net/gh/liwybloc/sonic-ws/bundled/SonicWS_bundle"></script>
            <title>SonicWS Debug Menu</title>
            <style>
                body {
                    margin: 0;
                    font-family: Inter, Arial, sans-serif;
                    background: #0f1115;
                    color: #e6e6e6;
                    height: 100vh;
                    display: flex;
                }

                #sidebar {
                    width: 260px;
                    background: #141821;
                    border-right: 1px solid #1f2533;
                    display: flex;
                    flex-direction: column;
                }

                #sidebar-header {
                    padding: 16px;
                    font-weight: 600;
                    font-size: 18px;
                    border-bottom: 1px solid #1f2533;
                    cursor: pointer;
                    transition: color 0.2s;
                }
                #sidebar-header:hover {
                    color: #dddddd;
                }

                #socket-list {
                    flex: 1;
                    overflow-y: auto;
                }

                .socket-item {
                    padding: 10px 14px;
                    cursor: pointer;
                    border-bottom: 1px solid #1f2533;
                }

                .socket-item:hover {
                    background: #1b2030;
                }

                .socket-item.active {
                    background: #22294a;
                }

                .socket-id {
                    font-size: 12px;
                    opacity: 0.7;
                }

                #main {
                    flex: 1;
                    display: flex;
                    flex-direction: column;
                }

                #main-header {
                    padding: 17px;
                    border-bottom: 1px solid #1f2533;
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                }

                #stats {
                    display: flex;
                    gap: 20px;
                    font-size: 13px;
                }

                #packets {
                    flex: 1;
                    overflow-y: auto;
                    padding: 12px;
                }

                .packet {
                    background: #1a1f2e;
                    border-radius: 6px;
                    padding: 6px 8px;
                    margin-bottom: 4px;
                    font-size: 12px;
                    cursor: pointer;
                }

                .packet.sent { border-left: 3px solid #3cff7a; }
                .packet.recv { border-left: 3px solid #ff5a5a; }

                .packet-details {
                    display: none;
                    margin-top: 4px;
                    opacity: 0.75;
                    font-size: 11px;
                }

                .packet.expanded .packet-details {
                    display: block;
                }

                button {
                    background: none;
                }
            </style>
        </head>
        <body>
            <div id="sidebar">
                <div id="sidebar-header">Sonic WS Debug Menu</div>
                <div id="socket-list"></div>
            </div>

            <div id="main">
                <div id="main-header">
                    <button id="close-socket" style="display:none;">❌</button>
                    <div id="socket-title">Server Home</div>
                    <div id="stats"></div>
                </div>
                <div id="home" style="display: block; padding: 16px;">
                    <h2>Server Dashboard</h2>
                    <div id="global-stats" style="margin-bottom:16px;"></div>
                    <h3>Connection Logs</h3>
                    <ul id="connection-logs" style="max-height:200px; overflow-y:auto; padding-left:16px;"></ul>
                    <div style="margin-top:16px;">
                        <table style="width:100%; border-collapse:collapse;">
                            <thead>
                                <tr>
                                    <th style="border-bottom:1px solid #444; text-align:left;">Socket ID</th>
                                    <th style="border-bottom:1px solid #444; text-align:left;">Name</th>
                                    <th style="border-bottom:1px solid #444; text-align:left;">Status</th>
                                </tr>
                            </thead>
                            <tbody id="connection-table"></tbody>
                        </table>
                    </div>
                </div>
                <div id="packets"></div>
            </div>

        <script>
            const socketList = document.getElementById('socket-list');
            const packetsDiv = document.getElementById('packets');
            const socketTitle = document.getElementById('socket-title');
            const debugTitle = document.getElementById('sidebar-header');
            const statsDiv = document.getElementById('stats');
            const home = document.getElementById('home');
            const closeSocketBtn = document.getElementById('close-socket');

            debugTitle.onclick = () => {
                if(activeId !== null) {
                    activeId = null;
                    packetsDiv.style.display = 'none';
                    home.style.display = 'block';
                    closeSocketBtn.style.display = 'none';
                    renderGlobalStats();
                }
            };

            const globalStats = {
                totalSockets: 0,
                totalSent: 0,
                totalRecv: 0,
                totalSentBytes: 0,
                totalRecvBytes: 0,
                totalSaved: 0,
                startTime: 0,
            };

            function formatMilliseconds(ms) {
                if (ms < 1) return '0.0s';

                const units = [
                    { label: 'week',   value: 7 * 24 * 60 * 60 * 1000 },
                    { label: 'day',    value: 24 * 60 * 60 * 1000 },
                    { label: 'hour',   value: 60 * 60 * 1000 },
                    { label: 'minute', value: 60 * 1000 },
                ];

                const parts = [];

                for (const { label, value } of units) {
                    const amount = Math.floor(ms / value);
                    if (amount > 0) {
                        parts.push(amount + ' ' + label + (amount !== 1 ? 's' : ''));
                        ms -= amount * value;
                    }
                }

                if (ms > 0 || parts.length === 0) {
                    const seconds = (ms / 1000).toFixed(1);
                    parts.push(seconds + 's');
                }

                if (parts.length === 1) return parts[0];
                const last = parts.pop();
                return parts.join(', ') + ' and ' + last;
            }


            const globalStatsDiv = document.getElementById('global-stats');
            function renderGlobalStats() {
                const stats = globalStats;
                const uptime = Date.now() - stats.startTime;
                const formattedUptime = formatMilliseconds(uptime);

                globalStatsDiv.innerHTML = '<div><strong>Total Sockets:</strong> ' + stats.totalSockets + '</div><div><strong>Total Sent Packets:</strong> ' + stats.totalSent + '</div><div><strong>Total Received Packets:</strong> ' + stats.totalRecv + '</div><div><strong>Total Sent Bytes:</strong> ' + stats.totalSentBytes + ' B</div><div><strong>Total Received Bytes:</strong> ' + stats.totalRecvBytes + ' B</div><div><strong>Total Bandwidth Saved:</strong> ' + stats.totalSaved + ' B</div><div><strong>Uptime:</strong> ' + formattedUptime + '</div>';
            }
            setInterval(renderGlobalStats, 50);

            function updateConnectionTable() {
                const tbody = document.getElementById('connection-table');
                tbody.innerHTML = '';
                sockets.forEach(s => {
                    const row = document.createElement('tr');
                    row.innerHTML = '<td>' + s.id + '</td><td>' + s.name + '</td><td style="color:' + (s.el.style.color || '#0f0') + '">' + (s.el.style.color === '#f00' ? 'Disconnected' : 'Connected') + '</td>';
                    tbody.appendChild(row);
                });
            }
            setInterval(updateConnectionTable, 1000);

            const sockets = new Map();
            let activeId = null;

            function selectSocket(id) {
                activeId = id;
                [...socketList.children].forEach(e => e.classList.toggle('active', e.dataset.id == id));

                const s = sockets.get(id);
                socketTitle.textContent = s.name;
                packetsDiv.innerHTML = '';
                s.packets.forEach(p => packetsDiv.appendChild(p.el));
                renderStats(s);
                home.style.display = 'none';
                packetsDiv.style.display = 'block';
                closeSocketBtn.style.display = 'block';
            }

            closeSocketBtn.onclick = () => {
                if(activeId === null) return;
                ws.send("close", Number(activeId));
            }

            function renderStats(s) {
                statsDiv.innerHTML = "<div>Sent: " + s.sent + "</div><div>Recv: " + s.recv + "</div><div>Sent bytes: " + s.sentBytes + "</div><div>Recv bytes: " + s.recvBytes + "</div><div>Saved: " + s.saved + "</div>";
            }

            function addSocket(id, name) {
                const el = document.createElement('div');
                el.className = 'socket-item';
                el.dataset.id = id;
                el.innerHTML = "<div>" + name + "</div><div class=\\"socket-id\\">#" + id + "</div>";
                el.onclick = () => selectSocket(id);
                socketList.appendChild(el);

                sockets.set(id, {
                    id,
                    name,
                    el,
                    packets: [],
                    sent: 0,
                    recv: 0,
                    sentBytes: 0,
                    recvBytes: 0,
                    saved: 0
                });
            }

            function removeSocket(id, code, reason, codeReason) {
                const s = sockets.get(id);
                if (!s) return console.error("Unknown socket!!", id);

                s.el.dataset.id = id + "-closed";
                s.el.onclick = () => selectSocket(id + "-closed");
                sockets.set(id + "-closed", s);
                sockets.delete(id);

                if(activeId == id) activeId = id + "-closed";

                const nameNode = s.el.childNodes[0];
                nameNode.style.color = "#f00";

                let circle = document.createElement('span');
                circle.style.display = 'inline-block';
                circle.style.width = '10px';
                circle.style.height = '10px';
                circle.style.borderRadius = '50%';
                circle.style.background = '#ff5a5a';
                circle.style.marginLeft = '8px';
                nameNode.appendChild(circle);

                // add disconnection info to home page logs
                const logItem = document.createElement('li');
                logItem.textContent = 'Socket #' + id + ' disconnected — Code: ' + code + ', Reason: ' + reason + ', Closure Cause: ' + codeReason;
                document.getElementById('connection-logs').appendChild(logItem);

                requestAnimationFrame(() => circle.style.width = '100%');
                setTimeout(() => {
                    circle.remove();
                    s.el.remove();
                    if(activeId == id + "-closed") {
                        packetsDiv.style.display = 'none';
                        home.style.display = 'block';
                        closeSocketBtn.style.display = 'none';
                    }
                }, 30000);
            }

            function addPacket(id, dir, tag, rawSize, saved, info, date, processTime) {
                const s = sockets.get(id);
                if (!s) return console.error("Unknown socket!!", id);

                const el = document.createElement('div');
                el.className = 'packet ' + (dir === 'sent' ? 'sent' : 'recv');
                el.innerHTML = '<div>' + tag + (info !== "undefined" ? ' — ' + info : '') + '</div><div class="packet-details">Raw Bytes: ' + rawSize + 'b (saved: ~' + saved + 'b)<br>Processed At: ' + new Date(date).toISOString() + '<br>Processing Time: ' + processTime.toFixed(2) + 'ms</div>';

                el.onclick = () => el.classList.toggle('expanded');

                s.packets.push({ el });
                if (dir === 'sent') {
                    s.sent++;
                    s.sentBytes += rawSize;
                } else {
                    s.recv++;
                    s.recvBytes += rawSize;
                }
                s.saved += saved;

                if (activeId === id) {
                    packetsDiv.appendChild(el);
                    renderStats(s);
                }
            }

            function setStat(i, v) {
                globalStats[Object.keys(globalStats)[i]] = v;
                if (activeId === null) renderGlobalStats();
            }

            const ws = new SonicWS('ws://' + location.host);

            ws.on("connection", id => addSocket(id, "Socket " + id));
            ws.on("disconnection", ([id, code], [reason, codeReason]) => removeSocket(id, code, reason, codeReason));
            ws.on("nameChange", ([id], [name]) => {
                const s = sockets.get(id);
                if (!s) return console.error("Unknown socket!!", id);
                s.name = name;
                s.el.firstChild.textContent = name;
                if (activeId === id) socketTitle.textContent = name;
            });
            ws.on("packet", ([id, size, saved], [dir], [tag], [values], [time, processTime]) => {
                console.log("Received packet", { id, size, saved, dir, tag, values, time, processTime });
                addPacket(id, dir, tag, size, saved, values, time, processTime);
            });
            ws.on("stats", (stats) => {
                console.log("Received stats", stats);
                stats.forEach((v, i) => setStat(i, v));
            });
            ws.on("stat", (i, v) => setStat(i, v));

            const lastKnownPassword = localStorage.getItem("password");
            const empty = !localStorage.getItem("req");
            let usedPass = "";
            ws.on_ready(() => {
                if(empty) ws.send("password", "");
                else ws.send("password", usedPass = (lastKnownPassword ?? prompt("Please enter password")));
            });

            ws.on_close(() => {
                window.location.reload();
            });

            ws.on("authenticated", (success) => {
                if(!success) {
                    localStorage.setItem("req", true);
                    localStorage.removeItem("password");
                    window.location.reload();
                } else {
                    localStorage.setItem("req", usedPass.length > 0);
                    localStorage.setItem("password", usedPass);
                }
            })
        </script>
        </body>
        </html>
        `
 */

        const server = http.createServer((req, res) => {
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(`<!doctypehtml><meta charset=UTF-8><script src=https://cdn.jsdelivr.net/gh/liwybloc/sonic-ws/bundled/SonicWS_bundle.js></script><title>SonicWS Debug Menu</title><style>body{margin:0;font-family:Inter,Arial,sans-serif;background:#0f1115;color:#e6e6e6;height:100vh;display:flex}#sidebar{width:260px;background:#141821;border-right:1px solid #1f2533;display:flex;flex-direction:column}#sidebar-header{padding:16px;font-weight:600;font-size:18px;border-bottom:1px solid #1f2533;cursor:pointer;transition:color .2s}#sidebar-header:hover{color:#ddd}#socket-list{flex:1;overflow-y:auto}.socket-item{padding:10px 14px;cursor:pointer;border-bottom:1px solid #1f2533}.socket-item:hover{background:#1b2030}.socket-item.active{background:#22294a}.socket-id{font-size:12px;opacity:.7}#main{flex:1;display:flex;flex-direction:column}#main-header{padding:17px;border-bottom:1px solid #1f2533;display:flex;justify-content:space-between;align-items:center}#stats{display:flex;gap:20px;font-size:13px}#packets{flex:1;overflow-y:auto;padding:12px}.packet{background:#1a1f2e;border-radius:6px;padding:6px 8px;margin-bottom:4px;font-size:12px;cursor:pointer}.packet.sent{border-left:3px solid #3cff7a}.packet.recv{border-left:3px solid #ff5a5a}.packet-details{display:none;margin-top:4px;opacity:.75;font-size:11px}.packet.expanded .packet-details{display:block}button{background:0 0}</style><div id=sidebar><div id=sidebar-header>Sonic WS Debug Menu</div><div id=socket-list></div></div><div id=main><div id=main-header><button id=close-socket style=display:none>❌</button><div id=socket-title>Server Home</div><div id=stats></div></div><div id=home style=display:block;padding:16px><h2>Server Dashboard</h2><div id=global-stats style=margin-bottom:16px></div><h3>Connection Logs</h3><ul id=connection-logs style=max-height:200px;overflow-y:auto;padding-left:16px></ul><div style=margin-top:16px><table style=width:100%;border-collapse:collapse><thead><tr><th style="border-bottom:1px solid #444;text-align:left">Socket ID<th style="border-bottom:1px solid #444;text-align:left">Name<th style="border-bottom:1px solid #444;text-align:left">Status<tbody id=connection-table></table></div></div><div id=packets></div></div><script>const socketList=document.getElementById("socket-list"),packetsDiv=document.getElementById("packets"),socketTitle=document.getElementById("socket-title"),debugTitle=document.getElementById("sidebar-header"),statsDiv=document.getElementById("stats"),home=document.getElementById("home"),closeSocketBtn=document.getElementById("close-socket");debugTitle.onclick=()=>{null!==activeId&&(activeId=null,packetsDiv.style.display="none",home.style.display="block",closeSocketBtn.style.display="none",renderGlobalStats())};const globalStats={totalSockets:0,totalSent:0,totalRecv:0,totalSentBytes:0,totalRecvBytes:0,totalSaved:0,startTime:0};function formatMilliseconds(e){if(e<1)return"0.0s";const t=[{label:"week",value:6048e5},{label:"day",value:864e5},{label:"hour",value:36e5},{label:"minute",value:6e4}],s=[];for(const{label:o,value:n}of t){const t=Math.floor(e/n);t>0&&(s.push(t+" "+o+(1!==t?"s":"")),e-=t*n)}if(e>0||0===s.length){const t=(e/1e3).toFixed(1);s.push(t+"s")}if(1===s.length)return s[0];const o=s.pop();return s.join(", ")+" and "+o}const globalStatsDiv=document.getElementById("global-stats");function renderGlobalStats(){const e=globalStats,t=formatMilliseconds(Date.now()-e.startTime);globalStatsDiv.innerHTML="<div><strong>Total Sockets:</strong> "+e.totalSockets+"</div><div><strong>Total Sent Packets:</strong> "+e.totalSent+"</div><div><strong>Total Received Packets:</strong> "+e.totalRecv+"</div><div><strong>Total Sent Bytes:</strong> "+e.totalSentBytes+" B</div><div><strong>Total Received Bytes:</strong> "+e.totalRecvBytes+" B</div><div><strong>Total Bandwidth Saved:</strong> "+e.totalSaved+" B</div><div><strong>Uptime:</strong> "+t+"</div>"}function updateConnectionTable(){const e=document.getElementById("connection-table");e.innerHTML="",sockets.forEach((t=>{const s=document.createElement("tr");s.innerHTML="<td>"+t.id+"</td><td>"+t.name+'</td><td style="color:'+(t.el.style.color||"#0f0")+'">'+("#f00"===t.el.style.color?"Disconnected":"Connected")+"</td>",e.appendChild(s)}))}setInterval(renderGlobalStats,50),setInterval(updateConnectionTable,1e3);const sockets=new Map;let activeId=null;function selectSocket(e){activeId=e,[...socketList.children].forEach((t=>t.classList.toggle("active",t.dataset.id==e)));const t=sockets.get(e);socketTitle.textContent=t.name,packetsDiv.innerHTML="",t.packets.forEach((e=>packetsDiv.appendChild(e.el))),renderStats(t),home.style.display="none",packetsDiv.style.display="block",closeSocketBtn.style.display="block"}function renderStats(e){statsDiv.innerHTML="<div>Sent: "+e.sent+"</div><div>Recv: "+e.recv+"</div><div>Sent bytes: "+e.sentBytes+"</div><div>Recv bytes: "+e.recvBytes+"</div><div>Saved: "+e.saved+"</div>"}function addSocket(e,t){const s=document.createElement("div");s.className="socket-item",s.dataset.id=e,s.innerHTML="<div>"+t+'</div><div class="socket-id">#'+e+"</div>",s.onclick=()=>selectSocket(e),socketList.appendChild(s),sockets.set(e,{id:e,name:t,el:s,packets:[],sent:0,recv:0,sentBytes:0,recvBytes:0,saved:0})}function removeSocket(e,t,s,o){const n=sockets.get(e);if(!n)return console.error("Unknown socket!!",e);n.el.dataset.id=e+"-closed",n.el.onclick=()=>selectSocket(e+"-closed"),sockets.set(e+"-closed",n),sockets.delete(e),activeId==e&&(activeId=e+"-closed");const c=n.el.childNodes[0];c.style.color="#f00";let l=document.createElement("span");l.style.display="inline-block",l.style.width="10px",l.style.height="10px",l.style.borderRadius="50%",l.style.background="#ff5a5a",l.style.marginLeft="8px",c.appendChild(l);const a=document.createElement("li");a.textContent="Socket #"+e+" disconnected — Code: "+t+", Reason: "+s+", Closure Cause: "+o,document.getElementById("connection-logs").appendChild(a),requestAnimationFrame((()=>l.style.width="100%")),setTimeout((()=>{l.remove(),n.el.remove(),activeId==e+"-closed"&&(packetsDiv.style.display="none",home.style.display="block",closeSocketBtn.style.display="none")}),3e4)}function addPacket(e,t,s,o,n,c,l,a){const d=sockets.get(e);if(!d)return console.error("Unknown socket!!",e);const i=document.createElement("div");i.className="packet "+("sent"===t?"sent":"recv"),i.innerHTML="<div>"+s+("undefined"!==c?" — "+c:"")+'</div><div class="packet-details">Raw Bytes: '+o+"b (saved: ~"+n+"b)<br>Processed At: "+new Date(l).toISOString()+"<br>Processing Time: "+a.toFixed(2)+"ms</div>",i.onclick=()=>i.classList.toggle("expanded"),d.packets.push({el:i}),"sent"===t?(d.sent++,d.sentBytes+=o):(d.recv++,d.recvBytes+=o),d.saved+=n,activeId===e&&(packetsDiv.appendChild(i),renderStats(d))}function setStat(e,t){globalStats[Object.keys(globalStats)[e]]=t,null===activeId&&renderGlobalStats()}closeSocketBtn.onclick=()=>{null!==activeId&&ws.send("close",Number(activeId))};const ws=new SonicWS("ws://"+location.host);ws.on("connection",(e=>addSocket(e,"Socket "+e))),ws.on("disconnection",(([e,t],[s,o])=>removeSocket(e,t,s,o))),ws.on("nameChange",(([e],[t])=>{const s=sockets.get(e);if(!s)return console.error("Unknown socket!!",e);s.name=t,s.el.firstChild.textContent=t,activeId===e&&(socketTitle.textContent=t)})),ws.on("packet",(([e,t,s],[o],[n],[c],[l,a])=>{console.log("Received packet",{id:e,size:t,saved:s,dir:o,tag:n,values:c,time:l,processTime:a}),addPacket(e,o,n,t,s,c,l,a)})),ws.on("stats",(e=>{console.log("Received stats",e),e.forEach(((e,t)=>setStat(t,e)))})),ws.on("stat",((e,t)=>setStat(e,t)));const lastKnownPassword=localStorage.getItem("password"),empty=!localStorage.getItem("req");let usedPass="";ws.on_ready((()=>{empty?ws.send("password",""):ws.send("password",usedPass=lastKnownPassword??prompt("Please enter password"))})),ws.on_close((()=>{window.location.reload()})),ws.on("authenticated",(e=>{e?(localStorage.setItem("req",usedPass.length>0),localStorage.setItem("password",usedPass)):(localStorage.setItem("req",!0),localStorage.removeItem("password"),window.location.reload())}));</script>`);
        });

        const TYPE_ENUM = DefineEnum("type", ["sent", "recv"]);
        const wss = new SonicWSServer({
            clientPackets: [
                CreatePacket({ tag: "password", type: PacketType.STRINGS_UTF16 }),
                CreatePacket({ tag: "close", type: PacketType.UVARINT }),
            ],
            serverPackets: [
                CreatePacket({ tag: "authenticated", type: PacketType.BOOLEANS }),

                CreatePacket({ tag: "connection", type: PacketType.UVARINT }),
                CreateObjPacket({ tag: "disconnection", types: [PacketType.UVARINT, PacketType.STRINGS], noDataRange: true }),

                CreateObjPacket({ tag: "nameChange", types: [PacketType.UVARINT, PacketType.STRINGS_UTF16], noDataRange: true }),
                CreateObjPacket({
                    tag: "packet",
                    types: [
                        PacketType.VARINT,
                        TYPE_ENUM,
                        PacketType.STRINGS_UTF16,
                        PacketType.STRINGS_UTF16,
                        PacketType.FLOATS,
                    ],
                    noDataRange: true,
                    dataBatching: 50,
                    maxBatchSize: 0,
                }),

                CreatePacket({ tag: "stats", type: PacketType.UVARINT, noDataRange: true, dontSpread: true }),
                CreatePacket({ tag: "stat", type: PacketType.UVARINT, dataMax: 2 }),
            ],
            websocketOptions: { server },
        });

        const globalStats = new Proxy({
            totalSockets: 0,
            totalSent: 0,
            totalRecv: 0,
            totalSentBytes: 0,
            totalRecvBytes: 0,
            totalSaved: 0,
            startTime: Date.now(),
        }, {
            set(target: any, prop: string | symbol, value: number) {
                const key = String(prop);
                if (target[key] !== value) {
                    target[key] = value;
                    wss.broadcast("stat", Object.keys(globalStats).indexOf(key), value);
                }
                return true;
            }
        });

        // TODO: i think this is fucked by async
        const storedPacketData: Record<number, any> = {};
        wss.on_connect(ws => {
            let authenticated = false;

            const ogs = ws.send.bind(ws);
            let queue: [string, any[]][] = [];
            ws.send = async (tag: string, ...values: any[]) => {
                console.log(authenticated, tag, values);
                if(!authenticated) queue.push([tag, values]);
                else ogs(tag, ...values);
            };

            ws.send("stats", ...Object.values(globalStats));
            host.connections.forEach(conn => {
                ws.send("connection", conn.id);
                ws.send("nameChange", conn.id, conn.getName());
                storedPacketData[conn.id]?.forEach((data: any) => {
                    ws.send("packet", ...data);
                });
            });

            ws.on("password", (pword: string) => {
                if(data.password != pword) {
                    ogs("authenticated", false);
                    setTimeout(() => ws.close(1008), 1000);
                } else {
                    authenticated = true;
                    ws.send("authenticated", true);
                    queue.forEach(([tag, values]) => ogs(tag, ...values));
                }
            });

            ws.on("close", (id: number) => {
                if(!authenticated) return;
                host.connectionMap[id]?.close(CloseCodes.MANUAL_SHUTDOWN);
            });
        });
        
        const innerConns: SonicWSConnection[] = [];
        const broadcastSends: Record<string, [any[], number, number][]> = {};

        const textEncoder = new TextEncoder();
        const length = (values: any[]) => textEncoder.encode(JSON.stringify(values) ?? "[]").length;

        host.addMiddleware(new (class implements ServerMiddleware {
            onClientConnect(connection: SonicWSConnection): boolean | void {
                globalStats.totalSockets++;
                storedPacketData[connection.id] = [];
                innerConns.push(connection);
                wss.broadcast("connection", connection.id);

                const packetsSend: Record<string, [any[], number, number][]> = {};
                const packetsRecv: Record<string, [Uint8Array, number, number][]> = {};
                connection.addMiddleware(new (class implements ConnectionMiddleware {
                    onNameChange(name: string): boolean | void {
                        wss.broadcast("nameChange", connection.id, name);
                    }
                    onSend_pre(tag: string, values: any[], date: number, perfTime: number): boolean | void {
                        packetsSend[tag] ??= [];
                        packetsSend[tag].push([values, perfTime, date]);
                    }
                    onSend_post(tag: string, data: Uint8Array, sendSize: number): void {
                        globalStats.totalSentBytes += sendSize;
                        globalStats.totalSent++;

                        const [values, perfTime, date] = packetsSend[tag].shift()!;
                        const jsonLength = length(values);
                        const saved = jsonLength - sendSize;

                        globalStats.totalSaved += saved;

                        const record = [
                            [connection.id, sendSize + 1, saved],
                            TYPE_ENUM.wrap("sent"),
                            tag,
                            JSON.stringify(values),
                            [date, performance.now() - perfTime],
                        ];
                        storedPacketData[connection.id].push(record);
                        wss.broadcast("packet", ...record);
                    }
                    onReceive_pre(tag: string, data: Uint8Array, recvSize: number): boolean | void {
                        globalStats.totalRecvBytes += recvSize;
                        globalStats.totalRecv++;
                        packetsRecv[tag] ??= [];
                        packetsRecv[tag].push([data, performance.now(), Date.now()]);
                    }
                    onReceive_post(tag: string, values: any[]): void {
                        const [data, time, date] = packetsRecv[tag].shift()!;
                        const jsonLength = length(values);
                        const saved = jsonLength - data.length;

                        globalStats.totalSaved += saved;

                        const record = [
                            [connection.id, data.length + 1, saved],
                            TYPE_ENUM.wrap("recv"),
                            tag,
                            JSON.stringify(values),
                            [date, performance.now() - time],
                        ];
                        storedPacketData[connection.id].push(record);
                        wss.broadcast("packet", ...record);
                    }
                })());
            }
            onClientDisconnect(connection: SonicWSConnection, code: number, reason?: Buffer<ArrayBufferLike>): void {
                globalStats.totalSockets--;
                wss.broadcast("disconnection", [connection.id, code], [reason?.toString() ?? "UNKNOWN", getClosureCause(code)]);
                delete storedPacketData[connection.id];
                innerConns.splice(innerConns.indexOf(connection), 1);
            }
            onPacketBroadcast_pre(tag: string, info: BCInfo, ...values: any[]): boolean | void {
                broadcastSends[tag] ??= [];
                broadcastSends[tag].push([values, performance.now(), Date.now()]);
            }
            onPacketBroadcast_post(tag: string, info: BCInfo, data: Uint8Array, sendSize: number): boolean | void {
                const [values, time, date] = broadcastSends[tag].shift()!;
                info.recipients.forEach(k => {
                    if(innerConns.includes(k)) {
                        k.callMiddleware("onSend_pre", tag, values, date, time);
                        k.callMiddleware("onSend_post", tag, data, sendSize);
                    }
                });
            }
        })());

        server.listen(data.port, () => {
            const address = server.address() as AddressInfo;
            console.log(`SWS Debug server running at http://localhost:${address.port}`);
            open(`http://localhost:${address.port}`);
        });
 
    }

}