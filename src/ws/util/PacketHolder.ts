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
        if(tag.includes(",")) {
            console.log(`Tag "${tag}" is invalid; keys cannot contain commas.`);
            return;
        }

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

    public getPacket(tag: string): Packet {
        return this.packetMap[tag];
    }

    public has(data: string): boolean {
        return this.tags[data.charCodeAt(0)] != null;
    }

    public getKeys(): Record<string, number> {
        return this.keys;
    }

    public serialize(): string {
        return this.packets.map(p => p.serialize()).join("");
    }

    public static empty(): PacketHolder {
        return new PacketHolder([]);
    }

}