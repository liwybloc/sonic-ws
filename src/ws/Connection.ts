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

import { ConnectionMiddleware, MiddlewareHolder } from "./PacketProcessor";

/**
 * Holds shared connection values. Lets helper functions work on client and server.
 * @internal
 */
export interface Connection extends MiddlewareHolder<ConnectionMiddleware> {

    /**
     * List of timers.
     * For internal use only.
     */
    _timers: Record<number, [number, (closed: boolean) => void, boolean]>;

    /**
     * Sets a timeout that will automatically end when the socket closes
     * @param call The function to call
     * @param time The time between now and the call (ms)
     * @param callOnClose If the callback should be fired anyways when the socket closes
     * @returns The timeout id to be used with socket.clearInterval(id)
     */
    setTimeout(call: () => void, time: number, callOnClose: boolean): number;
    /**
     * Sets an interval that will automatically end when the socket closes
     * @param call The function to call
     * @param time The time between calls (ms)
     * @returns The interval id to be used with socket.clearInterval(id)
     */
    setInterval(call: () => void, time: number): number;

    /**
     * Clears a timeout/interval
     * @param id The timeout id
     */
    clearTimeout(index: number): void;
    /**
     * Clears an interval
     * 
     * Delegates to `clearTimeout`
     * @param id The interval id
     */
    clearInterval(index: number): void;

    /**
     * Sends raw uint8array data through the connection
     */
    raw_send(data: Uint8Array): void;

    /**
     * Closes the connection
     */
    close(code?: number, reason?: string): void;

}

export enum CloseCodes {
    RATELIMIT          = 4000,
    SMALL              = 4001,
    INVALID_KEY        = 4002,
    INVALID_PACKET     = 4003,
    INVALID_DATA       = 4004,
    REPEATED_HANDSHAKE = 4005,
    DISABLED_PACKET    = 4006,
    MIDDLEWARE         = 4007,
    MANUAL_SHUTDOWN    = 4008,
}

export function getClosureCause(id: number): string {
    if (id >= 4000) {
        return CloseCodes[id as unknown as keyof typeof CloseCodes] as unknown as string ?? 'UNKNOWN';
    }

    switch (id) {
        case 1000:
            return 'NORMAL_CLOSURE';
        case 1001:
            return 'GOING_AWAY';
        case 1002:
            return 'PROTOCOL_ERROR';
        case 1003:
            return 'UNSUPPORTED_DATA';
        case 1006:
            return 'ABNORMAL_CLOSURE';
        default:
            return 'UNKNOWN';
    }
}