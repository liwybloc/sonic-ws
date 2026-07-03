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

import { IConnection } from "../../Connection";
import { Packet } from "../../packets/Packets";
import { SonicWSConnection } from "../../server/SonicWSConnection";
import { toPacketBuffer } from "../BufferUtil";
import { PacketHolder } from "./PacketHolder";
import { decodeNativeBatch, encodeNativeBatch } from "../../../native/wrapper";

/** @internal */
export class BatchHelper {

    private batchInfo: Record<number, [number, boolean]> = {};
    private batchTimeouts: Record<number, number> = {};
    private batchedData: Record<number, Uint8Array[]> = {};

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
        this.batchTimeouts[code] = this.conn.setInterval(() => {
            if(this.batchedData[code].length == 0) return;
            const data = encodeNativeBatch(this.batchedData[code], compressed);
            this.conn.raw_send(toPacketBuffer(code, data));
            this.batchedData[code] = [];
            delete this.batchTimeouts[code];
        }, time) as unknown as number;
    }

    public batchPacket(code: number, data: Uint8Array) {
        this.batchedData[code].push(data);

        if(!this.batchTimeouts[code]) this.startBatch(code);
    }

    public static async unravelBatch(packet: Packet<any>, _data: Uint8Array, socket: SonicWSConnection | null): Promise<[any, boolean][] | string> {
        let sectors: Uint8Array[];
        try {
            sectors = decodeNativeBatch(_data, packet.gzipCompression, packet.maxBatchSize);
        } catch (error) {
            return "Invalid batch: " + error;
        }
        const result: [any, boolean][] = [];
        for(const sector of sectors) {
            // call the packets listeners
            const listen = await packet.listen(sector, socket);

            // if invalid, return that
            if(typeof listen == 'string') return "Batched packet: " + listen;

            // store result
            result.push(listen);
        }
        return result;
    }
    
}
