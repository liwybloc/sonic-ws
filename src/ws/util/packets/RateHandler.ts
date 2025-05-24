/*
 * Copyright 2025 Lily (liwybloc)
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

import { SonicWSConnection } from "../../server/SonicWSConnection";
import { PacketHolder } from "./PacketHolder";

export class RateHandler {

    private rates: Record<string, number> = {};
    private limits: Record<string, number> = {};

    private setInterval: (call: () => void, time: number) => void;
    private socket: any;

    constructor(host: SonicWSConnection) {
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
            this.registerRate(prefix + packetHolder.getChar(packet.tag), packet.rateLimit);
    }

    public trigger(tag: string | number): boolean {
        if(tag in this.rates && ++this.rates[tag] > this.limits[tag]) {
            this.socket.close(4000);
            return true;
        }
        return false;
    }

    public subtract(tag: string | number) {
        if(!(tag in this.rates)) return;
        this.rates[tag]--;
    }

}