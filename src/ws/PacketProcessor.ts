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

import { Connection } from "./Connection";
import { SonicWSConnection } from "./server/SonicWSConnection";

/**
 * A basic middleware interface; extended by other middleware types
 */
export interface BasicMiddleware {
    /**
     * Called when the middleware is initialized
     * @param conn The connection instance
     */
    init?(conn: Connection): void;
}

export type FuncKeys<T> = { [K in keyof T]: NonNullable<T[K]> extends (...args: any[]) => any ? K : never }[keyof T];

export interface MiddlewareHolder<T extends BasicMiddleware> {
    /**
     * Adds middleware which can interact with packets and other events
     */
    addMiddleware(middleware: T): void;

    /**
     * Calls a middleware method on all middlewares
     * @param method The method to call
     * @param values The values to pass to the method
     */
    callMiddleware<K extends FuncKeys<T> & keyof T>(
        method: K,
        ...values: Parameters<NonNullable<Extract<T[K], (...args: any[]) => any>>>
    ): Promise<boolean>;
}

/**
 * A connection middleware interface, used in SonicWSConnection and ClientCore
 */
export interface ConnectionMiddleware extends BasicMiddleware {

    /**
     * Called before a packet is received
     * @param tag The packet tag
     * @param data The raw packet data
     * @param recvSize The size of the received packet
     * @returns `true` to cancel processing, `false` or nothing to continue
     */
    onReceive_pre?(tag: string, data: Uint8Array, recvSize: number): boolean | void;
    /**
     * Called before a packet is sent
     * @param tag The packet tag
     * @param values The packet values
     * @param processedAt The time the packet was processed at; Date.now()
     * @param perfTime The performance time the packet was processed at; performance.now()
     * @returns `true` to cancel processing, `false` or nothing to continue
     */
    onSend_pre?(tag: string, values: any[], processedAt: number, perfTime: number): boolean | void;

    /**
     * Called after a packet is received and listeners have been processed
     * @param tag The packet tag
     * @param values The packet values
     */
    onReceive_post?(tag: string, values: any[]): void;
    /**
     * Called after a packet is sent
     * @param tag The packet tag
     * @param data The raw packet data
     * @param sendSize The size of the sent packet
     */
    onSend_post?(tag: string, data: Uint8Array, sendSize: number): void;

    /**
     * Called when the connection status changes
     * @param status The new connection status
     */
    onStatusChange?(status: number): void;

    /**
     * Called when the name of the connection changes; server-side only
     * @param name The new name of the connection
     * @returns `true` to cancel setting the name, `false` or nothing to continue
     */
    onNameChange?(name: string): boolean | void;

};

/**
 * Different types of broadcast information
 */
export type BCInfo = { recipients: SonicWSConnection[] } & ({ type: "all" } | { type: "tagged", tag: string } | { type: "filter", filter: (connection: SonicWSConnection) => boolean });

/**
 * Server-sided middleware, used in SonicWSServer for a more broad range of events
 * This does not include information for packets sent and received, as that is handled by ConnectionMiddleware
 */
export interface ServerMiddleware extends BasicMiddleware {
    
    /**
     * Called when a client connects
     * @param connection The connection instance
     */
    onClientConnect?(connection: SonicWSConnection): boolean | void;
    /**
     * Called when a client disconnects
     * @param connection The connection instance
     * @param code The disconnect code
     * @param reason The disconnect reason
     */
    onClientDisconnect?(connection: SonicWSConnection, code: number, reason?: Buffer<ArrayBufferLike>): void;

    /**
     * Called when a packet is broadcasted
     * @param tag The packet tag
     * @param info The broadcast information
     * @param values The packet values
     */
    onPacketBroadcast_pre?(tag: string, info: BCInfo, ...values: any[]): boolean | void;

    /**
     * Called when a packet is processed after being broadcasted
     * @param tag The packet tag
     * @param info The broadcast information
     * @param values The packet values
     */
    onPacketBroadcast_post?(tag: string, info: BCInfo, data: Uint8Array, sendSize: number): boolean | void;


};

export type ServerPQ = [tag: string, value: Uint8Array];
export type ClientPQ = Uint8Array;

export type PacketQueue<T> = (T | null)[];
export type AsyncPQ<T> = [boolean, PacketQueue<T>];
export type SendQueue = [boolean, [Function, string, any[]][], string?];