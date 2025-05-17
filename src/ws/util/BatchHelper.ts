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

import { Packet } from "../packets/Packets";
import { PacketHolder } from "./PacketHolder";

export class BatchHelper {

    public batchedData: Record<string, string[]> = {};

    public registerSendPackets(packetHolder: PacketHolder, intervalFunc: any, sendFunc: any) {
        packetHolder.getTags().forEach(tag => {
            const packet = packetHolder.getPacket(tag);
            if(packet.dataBatching == 0) return;
            const code = packetHolder.getChar(tag);
            this.initiateBatch(code, packet.dataBatching, intervalFunc, sendFunc);
        });
    }

    public initiateBatch(code: string, time: number, intervalFunc: any, sendFunc: any) {
        this.batchedData[code] = [];
        intervalFunc(() => {
            if(this.batchedData[code].length == 0) return;
            sendFunc(code + this.batchedData[code].map(v => String.fromCharCode(v.length) + v).join(""));
            this.batchedData[code] = [];
        }, time);
    }

    public batchPacket(code: string, data: string, maxBatchSize: number, processRate: any) {
        if(this.batchedData[code].length == maxBatchSize && processRate != null) {
            // hacky, update later
            processRate(code + String.fromCharCode(data.length) + data);
            return;
        }
        this.batchedData[code].push(data);
    }

    public static unravelBatch(packet: Packet, data: string): any[] | null {
        const result: any[] = [];
        for(let i=0;i<data.length;) {
            if(result.length > packet.maxBatchSize) return null;
            const len = data.charCodeAt(i++);
            if(i + len > data.length) return null;
            const sect = data.substring(i, i += len);
            const listen = packet.listen(sect);
            if(typeof listen == 'string') return null;
            result.push([listen[0], !packet.dontSpread]);
        }
        return result;
    }
    
}