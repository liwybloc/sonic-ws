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

import WS from 'ws';
import { SonicWSCore } from "../core/ClientCore";

/** Class to connect to a SonicWS server */
export class SonicWS extends SonicWSCore<WS.WebSocket, Buffer> {
    /**
     * Creates a connection to the url
     * @param url The url to connect to
     * @param options The websocket options
     */
    constructor(url: string, options?: WS.ClientOptions) {
        const ws = new WS.WebSocket(url, options);
        super(ws, (val: Buffer) => Promise.resolve(new Uint8Array(val)), ws.addEventListener.bind(ws), ws.removeEventListener.bind(ws));
    }
}