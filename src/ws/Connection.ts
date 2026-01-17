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

export interface BasicMiddleware {

    init?(conn: Connection): void;

    onReceive_pre(tag: string, data: Uint8Array): boolean | void;
    onSend_pre(tag: string, values: any[]): boolean | void;

    onReceive_post(tag: string, values: any[]): boolean | void;
    onSend_post(tag: string, data: Uint8Array): boolean | void;

    onStatusChange(status: number): void;

};

/**
 * Holds shared connection values. Lets helper functions work on client and server.
 */
export interface Connection {

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

    /**
     * Adds a basic middleware which can interact with packets
     */
    addBasicMiddleware(middleware: BasicMiddleware): void;

}