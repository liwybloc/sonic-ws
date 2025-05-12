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
    public getTags(): Record<number, string> {
        return this.tags;
    }

    public serialize(): string {
        return this.packets.map(p => p.serialize()).join("");
    }

    public static empty(): PacketHolder {
        return new PacketHolder([]);
    }

}