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

import { CloseCodes, Connection } from "../../Connection";
import { SonicWSConnection } from "../../server/SonicWSConnection";
import { PacketHolder } from "./PacketHolder";

/** @internal */
export class RateHandler<T extends SonicWSConnection> {

    private rates: Record<string, number> = {};
    private limits: Record<string, number> = {};

    private setInterval: (call: () => void, time: number) => void;
    private socket: T['socket'];

    constructor(host: T) {
        // shared values
        this.setInterval = host.setInterval;
        this.socket = host.socket;
    }

    public start() {
        // no rates? don't start an interval
        if(Object.keys(this.rates).length == 0) return;
        this.setInterval(() => {
            for (const tag in this.rates) {
                this.rates[tag] = 0;
            }
        }, 1000);
    }

    public registerRate(tag: string, limit: number) {
        // ignore no limits
        if(limit == 0) return;

        this.rates[tag] = 0;
        this.limits[tag] = limit;
    }

    public registerAll(packetHolder: PacketHolder, prefix: string) {
        const packets = packetHolder.getPackets();
        for(const packet of packets)
            this.registerRate(prefix + packetHolder.getKey(packet.tag), packet.rateLimit);
    }

    public trigger(tag: string | number): boolean {
        if(tag in this.rates && ++this.rates[tag] > this.limits[tag]) {
            this.socket.close(CloseCodes.RATELIMIT);
            return true;
        }
        return false;
    }

    public subtract(tag: string | number) {
        if(!(tag in this.rates)) return;
        this.rates[tag]--;
    }

}