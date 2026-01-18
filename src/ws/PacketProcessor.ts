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

export interface BasicMiddleware {
    init?(conn: Connection): void;
}

export interface ConnectionMiddleware extends BasicMiddleware {

    onReceive_pre?(tag: string, data: Uint8Array, recvSize: number): boolean | void;
    onSend_pre?(tag: string, values: any[]): boolean | void;

    onReceive_post?(tag: string, values: any[]): boolean | void;
    onSend_post?(tag: string, data: Uint8Array, sendSize: number): boolean | void;

    onStatusChange?(status: number): void;

};

export type BCInfo = { type: "all" } | { type: "tagged", tag: string } | { type: "filter", filter: (connection: SonicWSConnection) => boolean };
export interface ServerMiddleware extends BasicMiddleware {
    
    onClientConnect?(connection: SonicWSConnection): boolean | void;
    onClientDisconnect?(connection: SonicWSConnection, code: number, reason: string): void;

    onPacketBroadcast?(tag: string, info: BCInfo, ...values: any[]): boolean | void;

};

export type ServerPQ = [tag: string, value: Uint8Array];
export type ClientPQ = Uint8Array;

export type PacketQueue<T> = (T | null)[];
export type AsyncPQ<T> = [boolean, PacketQueue<T>];
export type SendQueue = [boolean, [Function, string, any[]][], string?];