/*
 * Copyright 2025 Lily (cutelittlelily)
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

import { SonicWSCore } from "../../client/core/ClientCore";
import { Packet } from "../../packets/Packets";
import { SonicWSConnection } from "../../server/SonicWSConnection";
import { PacketHolder } from "./PacketHolder";

export class BatchHelper {

    public batchedData: Record<string, string[]> = {};

    public registerSendPackets(packetHolder: PacketHolder, clazz: SonicWSCore | SonicWSConnection) {
        packetHolder.getTags().forEach(tag => {
            const packet = packetHolder.getPacket(tag);
            if(packet.dataBatching == 0) return;
            const code = packetHolder.getChar(tag);
            this.initiateBatch(code, packet.dataBatching, clazz);
        });
    }

    public initiateBatch(code: string, time: number, clazz: SonicWSCore | SonicWSConnection) {
        this.batchedData[code] = [];
        clazz.setInterval(() => {
            if(this.batchedData[code].length == 0) return;
            clazz.raw_send(code + this.batchedData[code].join(""));
            this.batchedData[code] = [];
        }, time);
    }

    public batchPacket(code: string, data: string) {
        this.batchedData[code].push(String.fromCharCode(data.length) + data);
    }

    public static unravelBatch(packet: Packet, data: string, socket: SonicWSConnection | null): any[] | string {
        const result: any[] = [];
        for(let i=0;i<data.length;) {
            if(result.length > packet.maxBatchSize) return "Too big of batch";
            const len = data.charCodeAt(i++);
            if(i + len > data.length) return "Tampered batch length";
            const sect = data.substring(i, i += len);
            const listen = packet.listen(sect, socket);
            if(typeof listen == 'string') return "Batched packet: " + listen;
            result.push([listen[0], !packet.dontSpread]);
        }
        return result;
    }
    
}