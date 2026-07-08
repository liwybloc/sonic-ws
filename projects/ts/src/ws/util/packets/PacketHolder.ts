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

import { Packet } from "../../packets/Packets";
import { PacketType } from "../../packets/PacketType";
import type { PacketArray } from "./PacketUtils";
import { AssertPacketSchema } from "./metadata/SchemaValidation";

/**
 * Holds and maps packets to indexed keys and tags for serialization and lookup
 * @internal
 */
export class PacketHolder {

    /** Current key index for packet tags */
    private key: number;
    /** Maps tags to keys */
    private keys: Record<string, number>;
    /** Maps keys to tags */
    private tags: Record<number, string>;
    /** Maps tags to packet instances */
    private packetMap: Record<string, Packet<PacketType | readonly PacketType[], any>>;
    /** List of all packet instances */
    private packets!: PacketArray;
    private variants: Record<string, string> = {};
    private parents = new Set<string>();

    /**
     * Creates a new PacketHolder with an array of packets
     * @param packets Array of packets to register
     */
    constructor(packets?: PacketArray) {

        // reserves:
        // 0 - enum update

        this.key = 1;

        this.keys = {} as any;
        this.tags = {};
        this.packetMap = {} as any;

        if(!packets) return;
        this.holdPackets(packets);
    }

    /** Assigns a new unique key to a tag */
    public createKey(tag: string): void {
        this.keys[tag] = this.key;
        this.tags[this.key] = tag;
        this.key++;
    }

    /**
     * Registers an array of packets and assigns them keys
     * @param packets Array of packets to register
     */
    public holdPackets(packets: PacketArray): void {
        AssertPacketSchema(packets);
        this.packets = packets;
        for (const packet of packets) {
            this.createKey(packet.tag);
            this.packetMap[packet.tag] = packet;
            if (packet.parent && packet.variant) {
                this.variants[`${packet.parent}.${packet.variant}`] = packet.tag;
                this.parents.add(packet.parent);
            }
            if (packet.isParent) this.parents.add(packet.tag);
        }
    }

    /**
     * Returns the numeric key for a given tag
     * @param tag The packet tag
     */
    public getKey(tag: string): number {
        tag = this.resolveTag(tag);
        if(!(tag in this.keys)) throw new Error(`Not a valid tag: ${tag}`);
        return this.keys[tag];
    }

    /**
     * Returns the tag associated with a given character key
     * @param key Key bytre
     */
    public getTag(key: number): string | undefined {
        if(!(key in this.tags)) return undefined;
        return this.tags[key];
    }

    /**
     * Returns the packet instance associated with a tag
     * @param tag The packet tag
     */
    public getPacket(tag: string): Packet<any> {
        tag = this.resolveTag(tag);
        if(!(tag in this.packetMap)) throw new Error("Unknown packet tag: " + tag);
        return this.packetMap[tag];
    }

    /**
     * Checks if a given character key exists
     * @param key A string index
     */
    public hasKey(key: number): key is keyof typeof this.tags {
        return key in this.tags;
    }

    /**
     * Checks if a tag has been assigned a key
     * @param tag The packet tag
     */
    public hasTag(tag: string): boolean {
        return this.resolveTag(tag) in this.keys || this.parents.has(tag);
    }

    public resolveTag(tag: string): string { return this.variants[tag] ?? tag; }

    public getVariantTag(parent: string, variant: string): string {
        const tag = this.variants[`${parent}.${variant}`];
        if (!tag) throw new Error(`Unknown packet variant: ${parent}.${variant}`);
        return tag;
    }

    public getPermutationVariant(
        parent: string,
        selection: readonly boolean[] | Record<string, boolean>,
    ): string {
        const values = this.getPacket(parent).permutationValues;
        if (!values) throw new Error(`Packet group "${parent}" does not define a VariantPermutation`);
        let enabled: string[];
        if (Array.isArray(selection)) {
            if (selection.length !== values.length || selection.some(value => typeof value !== "boolean")) {
                throw new Error(`Variant permutation requires ${values.length} boolean flags`);
            }
            enabled = values.filter((_, index) => selection[index]);
        } else {
            const mapping = selection as Record<string, boolean>;
            const keys = Object.keys(mapping);
            if (keys.length !== values.length
                || keys.some(key => !values.includes(key) || typeof mapping[key] !== "boolean")) {
                throw new Error("Variant permutation object must define every known key as a boolean");
            }
            enabled = values.filter(value => mapping[value]);
        }
        if (!enabled.length) return parent;
        const variant = Object.keys(this.variants)
            .filter(key => key.startsWith(`${parent}.`))
            .map(key => key.slice(parent.length + 1))
            .find(candidate => {
                const selected = candidate.split(",");
                return selected.length === enabled.length && selected.every(value => enabled.includes(value));
            });
        if (!variant) throw new Error("Variant permutation contains an invalid or opposite combination");
        return this.getVariantTag(parent, variant);
    }

    /** Returns the mapping of tags to keys */
    public getKeys(): Record<string, number> {
        return this.keys;
    }

    /** Returns the mapping of keys to tags */
    public getTagMap(): Record<number, string> {
        return this.tags;
    }

    /** Returns an array of all registered tags */
    public getTags(): string[] {
        return Object.values(this.tags);
    }

    /** Returns the list of all registered packets */
    public getPackets(): PacketArray {
        return this.packets;
    }

    /** Serializes all registered packets into a string */
    public serialize(): number[] {
        return this.packets.map(p => p.serialize()).flat();
    }

}
