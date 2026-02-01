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

import { ConnectionMiddleware, IMiddlewareHolder, MiddlewareHolder } from "./PacketProcessor";
import { BatchHelper } from "./util/packets/BatchHelper";

/**
 * Holds shared connection values. Lets helper functions work on client and server.
 */
export interface IConnection<T> extends IMiddlewareHolder<ConnectionMiddleware> {

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
     * Listens for all messages rawly
     * @param listener Callback for when data is received
     */
    raw_onmessage(listener: (data: T) => void): void;

    /**
     * Closes the connection
     */
    close(code?: number, reason?: string): void;

    /**
     * Checks if the connection is closed
     * @returns If it's closed or not
     */
    isClosed(): boolean;

    /**
     * Sets the name of this connection for the debug menu; good for setting e.g. usernames on games
     */
    setName(name: string): Promise<void>;

    /**
     * @returns Name of the socket, defaults to Socket [ID] or LocalSocket unless set with setName()
     */
    getName(): string;

}

export abstract class Connection<T extends {
    readyState: number,
    send: (u: Uint8Array) => void,
    close: (c: number, d: string | undefined) => void,
}, K> extends MiddlewareHolder<ConnectionMiddleware> implements IConnection<K> {

    protected listeners: Record<string, Array<(...data: any[]) => void>>;

    private name: string;
    protected closed: boolean = false;
    socket: T;
    _timers: Record<number, [number, (closed: boolean) => void, boolean]> = {};

    protected batcher: BatchHelper;

    _on: Function;
    _off: Function;

    /** The index of the connection; unique for all connected, not unique after disconnection. */
    public id: number;

    constructor(socket: T, id: number, name: string, addListener: Function, removeListener: Function) {
        super();
        this.id = id;
        this.listeners = {};

        this.name = name;
        this.socket = socket;

        this.batcher = new BatchHelper();

        this._on = addListener;
        this._off = removeListener;
        
        this._on("close", () => {
            this.callMiddleware('onStatusChange', WebSocket.CLOSED);
            this.closed = true;
            for(const [id, callback, shouldCall] of Object.values(this._timers)) {
                this.clearTimeout(id);
                if(shouldCall) callback(true);
            }
        });

        this._on('open', () => this.callMiddleware('onStatusChange', WebSocket.OPEN));
    }

    public setTimeout(call: () => void, time: number, callOnClose: boolean = false): number {
        const timeout = setTimeout(() => {
            call();
            this.clearTimeout(timeout);
        }, time) as unknown as number;
        this._timers[timeout] = [timeout, call, callOnClose];
        return timeout;
    }

    public setInterval(call: () => void, time: number, callOnClose: boolean = false): number {
        const interval = setInterval(call, time) as unknown as number;
        this._timers[interval] = [interval, call, callOnClose];
        return interval;
    }

    public clearTimeout(id: number): void {
        clearTimeout(id);
        delete this._timers[id];
    }

    public clearInterval(id: number): void {
        this.clearTimeout(id);
    }

    public raw_send(data: Uint8Array): void {
        this.socket.send(data);
    }

    public raw_onmessage(listener: (data: K) => void): void {
        this._on("message", listener);
    }

    public close(code: number = 1000, reason?: string | Buffer): void {
        this.closed = true;
        this.socket.close(code, reason?.toString());
    }

    public isClosed(): boolean {
        return this.closed || this.socket.readyState == WebSocket.CLOSED;
    }

    public async setName(name: string): Promise<void> {
        if(await this.callMiddleware("onNameChange", name)) return;
        this.name = name;
    }

    public getName(): string {
        return this.name;
    }

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