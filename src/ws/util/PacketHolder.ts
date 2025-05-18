import { Packet } from "../packets/Packets";

/**
 * Holds and maps packets to indexed keys and tags for serialization and lookup
 */
export class PacketHolder {

    /** Current key index for packet tags */
    private key: number;
    /** Maps tags to keys */
    private keys: Record<string, number>;
    /** Maps keys to tags */
    private tags: Record<number, string>;
    /** Maps tags to packet instances */
    private packetMap: Record<string, Packet>;
    /** List of all packet instances */
    private packets: Packet[];

    /**
     * Creates a new PacketHolder with an array of packets
     * @param packets Array of packets to register
     */
    constructor(packets: Packet[]) {
        this.key = 1;
        this.keys = {};
        this.tags = {};
        this.packets = packets;
        this.packetMap = {};
        this.createPackets(packets);
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
    public createPackets(packets: Packet[]): void {
        for (const packet of packets)
            this.createKey(packet.tag), this.packetMap[packet.tag] = packet;
    }

    /**
     * Returns the numeric key for a given tag
     * @param tag The packet tag
     */
    public get(tag: string): number {
        return this.keys[tag];
    }

    /**
     * Returns the character representation of a tag's key
     * @param tag The packet tag
     */
    public getChar(tag: string): string {
        return String.fromCharCode(this.get(tag));
    }

    /**
     * Returns the tag associated with a given character key
     * @param key A 1-character string key
     */
    public getTag(key: string): string {
        return this.tags[key.charCodeAt(0)!];
    }

    /**
     * Returns the packet instance associated with a tag
     * @param tag The packet tag
     */
    public getPacket(tag: string): Packet {
        return this.packetMap[tag];
    }

    /**
     * Checks if a given character key exists
     * @param key A 1-character string key
     */
    public has(key: string): boolean {
        return key.charCodeAt(0) in this.tags;
    }

    /**
     * Checks if a tag has been assigned a key
     * @param tag The packet tag
     */
    public hasTag(tag: string): boolean {
        return tag in this.keys;
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
    public getPackets(): Packet[] {
        return this.packets;
    }

    /** Serializes all registered packets into a string */
    public serialize(): string {
        return this.packets.map(p => p.serialize()).join("");
    }

    /** Returns an empty PacketHolder instance */
    public static empty(): PacketHolder {
        return new PacketHolder([]);
    }

}