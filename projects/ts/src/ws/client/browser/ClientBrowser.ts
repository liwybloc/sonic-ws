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

import { DebugClient } from "../../debug/DebugClient";
import { WrapEnum, DeWrapEnum } from "../../util/enums/EnumHandler";
import { FlattenData, UnFlattenData } from "../../util/packets/PacketUtils";
import { ReconnectOptions, SonicWSCore } from "../core/ClientCore";
import { initializeWasmCore } from "../../../native/wrapper";

// defines the SonicWS browser class and delegates transport-specific functions
// types are here so you can do /** @type */

export class SonicWS extends SonicWSCore<WebSocket, MessageEvent> {

    /** Initializes the Rust WASM codec. Call this once before constructing a browser client. */
    static initialize(): Promise<unknown> {
        return initializeWasmCore();
    }

    /** Initializes WASM, connects, and resolves after schema negotiation. */
    static async connect(
        url: string,
        options: {
            protocols?: string | string[];
            antiTamper?: boolean;
            reconnect?: ReconnectOptions;
            readyTimeoutMs?: number;
        } = {},
    ): Promise<SonicWS> {
        await SonicWS.initialize();

        const client = new SonicWS(
            url,
            options.protocols,
            options.antiTamper ?? false,
            options.reconnect,
            options.readyTimeoutMs,
        );

        await new Promise<void>((resolve, reject) => {
            client.on_ready(resolve);
            client.on_close((event: CloseEvent) => {
                reject(new Error(`SonicWS connection closed before ready (${event.code})`));
            });
        });

        return client;
    }

    private antiTamperCall: () => void = () => { };

    /**
     * Creates a connection to the url
     * @param url The url to connect to
     * @param options The websocket options
     * @param antiTamper Attempts to prevent crude tampering with the socket. Defaults to false.
     */
    constructor(
        url: string,
        protocols?: string | string[],
        antiTamper: boolean = false,
        reconnect?: ReconnectOptions,
        readyTimeoutMs: number = 10_000,
    ) {
        const ws = new WebSocket(url, protocols);
        super(
            ws,
            async (event: MessageEvent) => new Uint8Array(await (event.data as Blob).arrayBuffer()),
            ws.addEventListener.bind(ws),
            ws.removeEventListener.bind(ws),
        );
        this.configureHandshakeTimeout(readyTimeoutMs);

        if (reconnect?.enabled) {
            if (antiTamper) {
                throw new Error("Reconnect and antiTamper cannot currently be enabled together");
            }

            this.configureReconnect(() => {
                const socket = new WebSocket(url, protocols);

                return {
                    socket,
                    bufferHandler: async (event: MessageEvent) =>
                        new Uint8Array(await (event.data as Blob).arrayBuffer()),
                    on: socket.addEventListener.bind(socket),
                    off: socket.removeEventListener.bind(socket),
                };
            }, reconnect);
        }

        if (antiTamper) {
            const client = this;
            const originalWebSocketSend = ws.send.bind(ws);
            const originalSonicSend = this.send.bind(this);
            let lastSend: number;

            this.send = async (tag: string, ...values: any[]) => {
                lastSend = client.clientPackets.getKey(tag);
                await originalSonicSend(tag, ...values);
            };

            ws.send = data => {
                if (!(data instanceof Uint8Array) || lastSend !== data[0]) {
                    client.antiTamperCall();
                    client.close();
                    return;
                }

                return originalWebSocketSend(data);
            };
        }
    }

    /**
     * If antiTamper is on, this will call when the tamper flag is violated. It will also automatically close the socket for you
     * @param callback 
     */
    on_tamper(callback: () => void): void {
        this.antiTamperCall = callback;
    }

    /**
     * Wraps an enum into a transmittable format
     * @param tag The tag of the enum
     * @param value The value to send
     * @returns A transmittable enum value
     */
    WrapEnum(tag: string, value: string): number {
        return WrapEnum(tag, value);
    }

    DeWrapEnum(tag: string, value: number): unknown {
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

    debugClient: DebugClient | null = null;

    /**
     * Creates a debug menu that shows information about the connection and packets.
     */
    OpenDebug(): void {
        if (this.debugClient != null) {
            throw new Error("A debug client is already open");
        }

        this.debugClient = new DebugClient(this);
    }

}

(window as any).SonicWS = SonicWS;
