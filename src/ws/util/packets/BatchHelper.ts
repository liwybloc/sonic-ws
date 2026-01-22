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

import { IConnection } from "../../Connection";
import { Packet } from "../../packets/Packets";
import { SonicWSConnection } from "../../server/SonicWSConnection";
import { toPacketBuffer } from "../BufferUtil";
import { compressGzip, convertVarInt, decompressGzip, readVarInt } from "./CompressionUtil";
import { PacketHolder } from "./PacketHolder";

/** @internal */
export class BatchHelper {

    private batchInfo: Record<number, [number, boolean]> = {};
    private batchTimeouts: Record<number, number> = {};
    private batchedData: Record<number, number[]> = {};

    private conn!: IConnection<any>;

    public registerSendPackets(packetHolder: PacketHolder, conn: IConnection<any>) {
        this.conn = conn;
        packetHolder.getTags().forEach(tag => {
            const packet = packetHolder.getPacket(tag);
            if(packet.dataBatching == 0) return;
            const code = packetHolder.getKey(tag);
            this.initiateBatch(code, packet.dataBatching, packet.gzipCompression);
        });
    }

    private initiateBatch(code: number, time: number, compressed: boolean) {
        this.batchedData[code] = [];
        this.batchInfo[code] = [time, compressed];
    }

    private startBatch(code: number) {
        const [time, compressed] = this.batchInfo[code];
        this.batchTimeouts[code] = this.conn.setInterval(async () => {
            if(this.batchedData[code].length == 0) return;
            const data = new Uint8Array(this.batchedData[code]);
            this.conn.raw_send(toPacketBuffer(code, compressed ? await compressGzip(data) : data));
            this.batchedData[code] = [];
            delete this.batchTimeouts[code];
        }, time) as unknown as number;
    }

    public batchPacket(code: number, data: Uint8Array) {
        const batch = this.batchedData[code];
        batch.push(...convertVarInt(data.length));
        data.forEach(val => batch.push(val));

        if(!this.batchTimeouts[code]) this.startBatch(code);
    }

    public static async unravelBatch(packet: Packet<any>, _data: Uint8Array, socket: SonicWSConnection | null): Promise<[any, boolean][] | string> {
        const data = packet.gzipCompression ? await decompressGzip(_data) : _data;
        const result: [any, boolean][] = [];
        for(let i=0;i<data.length;) {
            // must be >0 for it to apply
            if(packet.maxBatchSize > 0 && result.length > packet.maxBatchSize) return "Too big of batch";

            // read batch length
            const [off, varint] = readVarInt(data, i);
            i = off;

            // if it goes oob it's invalid
            if(i + varint > data.length) return "Tampered batch length";

            // read sector
            const sect = data.slice(i, i += varint);

            // call the packets listeners
            const listen = await packet.listen(sect, socket);

            // if invalid, return that
            if(typeof listen == 'string') return "Batched packet: " + listen;

            // store result
            result.push([listen[0], !packet.dontSpread]);
        }
        return result;
    }
    
}