import { VERSION } from "../../../version";
import { Packet } from "../../packets/Packets";
import { convertVarInt, readVarInt } from "./CompressionUtil";

const MAGIC = [0x53, 0x57, 0x53, 0x4d]; // SWSM

export type PacketManifest = {
    clientPackets: readonly Packet<any>[];
    serverPackets: readonly Packet<any>[];
};

/** Serializes both directional packet tables into a portable, versioned manifest. */
export function CreatePacketManifest(manifest: PacketManifest): Uint8Array {
    const clients = manifest.clientPackets.flatMap(packet => packet.serialize());
    const servers = manifest.serverPackets.flatMap(packet => packet.serialize());
    return Uint8Array.from([...MAGIC, VERSION, ...convertVarInt(clients.length), ...clients, ...servers]);
}

/** Loads a manifest produced by TypeScript or Python for the current protocol version. */
export function LoadPacketManifest(data: Uint8Array): { clientPackets: Packet<any>[]; serverPackets: Packet<any>[] } {
    if (data.length < 6 || MAGIC.some((byte, index) => data[index] !== byte))
        throw new Error("Invalid SonicWS packet manifest");
    if (data[4] !== VERSION)
        throw new Error(`Packet manifest protocol mismatch: ${data[4]} != ${VERSION}`);
    const [offset, clientLength] = readVarInt(data, 5);
    const end = offset + clientLength;
    if (end > data.length) throw new Error("Truncated SonicWS packet manifest");
    return {
        clientPackets: Packet.deserializeAll(data.slice(offset, end), false),
        serverPackets: Packet.deserializeAll(data.slice(end), false),
    };
}
