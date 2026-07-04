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
import { ReconnectOptions, SonicWSCore } from "../core/ClientCore";

export type SonicConnectOptions = WS.ClientOptions & {
    reconnect?: ReconnectOptions;
    readyTimeoutMs?: number;
};

/** Connects a Node.js process to a SonicWS server. */
export class SonicWS extends SonicWSCore<WS.WebSocket, Buffer> {
    /**
     * Creates a connection to the url
     * @param url The url to connect to
     * @param options The websocket options
     */
    constructor(
        url: string,
        options?: WS.ClientOptions,
        reconnect?: ReconnectOptions,
        readyTimeoutMs: number = 10_000,
    ) {
        const ws = new WS.WebSocket(url, options);
        ws.on("error", () => {});

        super(ws, (val: Buffer) => Promise.resolve(new Uint8Array(val)), ws.on.bind(ws), ws.off.bind(ws));
        this.configureHandshakeTimeout(readyTimeoutMs);

        if (reconnect?.enabled) {
            this.configureReconnect(() => {
                const socket = new WS.WebSocket(url, options);
                socket.on("error", () => {});

                return {
                    socket,
                    bufferHandler: (value: Buffer) => Promise.resolve(new Uint8Array(value)),
                    on: socket.on.bind(socket),
                    off: socket.off.bind(socket),
                };
            }, reconnect);
        }
    }

    /** Creates a client and resolves after WASM loading and schema negotiation. */
    static async connect(url: string, options: SonicConnectOptions = {}): Promise<SonicWS> {
        const { reconnect, readyTimeoutMs, ...websocketOptions } = options;
        const client = new SonicWS(url, websocketOptions, reconnect, readyTimeoutMs);
        await new Promise<void>((resolve, reject) => {
            client.on_ready(resolve);
            client.on_close((code: number, reason: Buffer) => {
                if (!client.clientPackets.getPackets()?.length) {
                    reject(new Error(`SonicWS connection closed before ready (${code}: ${reason})`));
                }
            });
        });

        return client;
    }
}
