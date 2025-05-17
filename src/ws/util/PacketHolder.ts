/*
 * Copyright 2025 Lily (cutelittlelily)
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

import { Packet } from "../packets/Packets";

export class PacketHolder {

    private key: number;
    private keys: Record<string, number>;
    private tags: Record<number, string>;
    private packetMap: Record<string, Packet>;
    private packets: Packet[];

    constructor(packets: Packet[]) {
        this.key = 1;
        this.keys = {};
        this.tags = {};
        this.packets = packets;
        this.packetMap = {};
        this.createPackets(packets);
    }

    public createKey(tag: string): void {
        this.keys[tag] = this.key;
        this.tags[this.key] = tag;
        this.key++;
    }
    public createPackets(packets: Packet[]): void {
        for (const packet of packets) {
            this.createKey(packet.tag);
            this.packetMap[packet.tag] = packet;
        }
    }

    public get(tag: string): number {
        return this.keys[tag];
    }
    public getChar(tag: string): string {
        return String.fromCharCode(this.get(tag));
    }
    public getTag(key: string): string {
        return this.tags[key.charCodeAt(0)!];
    }
    public getPacket(tag: string): Packet {
        return this.packetMap[tag];
    }

    public has(key: string): boolean {
        return key.charCodeAt(0) in this.tags;
    }
    public hasTag(tag: string): boolean {
        return tag in this.keys;
    }

    public getKeys(): Record<string, number> {
        return this.keys;
    }
    public getTagMap(): Record<number, string> {
        return this.tags;
    }
    public getTags(): string[] {
        return Object.values(this.tags);
    }
    public getPackets(): Packet[] {
        return this.packets;
    }

    public serialize(): string {
        return this.packets.map(p => p.serialize()).join("");
    }

    public static empty(): PacketHolder {
        return new PacketHolder([]);
    }

}