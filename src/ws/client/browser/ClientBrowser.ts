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

import { WrapEnum, DeWrapEnum } from "../../util/enums/EnumHandler";
import { FlattenData, UnFlattenData } from "../../util/packets/PacketUtils";
import { SonicWSCore } from "../core/ClientCore";

// Defines SonicWS class in the browser and gives delegation of functions
// types are here so you can do /** @type */

export class SonicWS extends SonicWSCore {

    private antiTamperCall: () => void = () => {};

    /**
     * Creates a connection to the url
     * @param url The url to connect to
     * @param options The websocket options
     * @param antiTamper Attempts to prevent crude tampering with the socket. Defaults to false.
     */
    constructor(url: string, protocols?: string | string[], antiTamper: boolean = false) {
        const ws = new WebSocket(url, protocols);
        super(ws, async (val: MessageEvent) => new Uint8Array(await (val.data as Blob).arrayBuffer()));

        if(antiTamper) {
            const thiz = this;
            const ogWSSend = ws.send.bind(ws);
            const ogTSSend = this.send.bind(this);
            let lastSend: number;
            this.send = (key: string, ...values: any[]) => {
                lastSend = thiz.clientPackets.getKey(key);
                ogTSSend(key, ...values);
            };
            ws.send = (v) => {
                if(!(v instanceof Uint8Array) || lastSend != v[0]) {
                    thiz.antiTamperCall();
                    thiz.close();
                    return;
                }
                ogWSSend(v);
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
}

(window as any).SonicWS = SonicWS;