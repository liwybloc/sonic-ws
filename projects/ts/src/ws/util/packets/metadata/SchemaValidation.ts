import { Packet } from "../../../packets/Packets";
import { PacketType } from "../../../packets/PacketType";

export type SchemaValidationResult = { errors: string[]; warnings: string[] };

const UNSIGNED = new Set([PacketType.UBYTES, PacketType.USHORTS, PacketType.UVARINT]);
const NUMERIC = new Set([
    PacketType.BYTES, PacketType.UBYTES, PacketType.SHORTS, PacketType.USHORTS,
    PacketType.VARINT, PacketType.UVARINT, PacketType.DELTAS, PacketType.FLOATS, PacketType.DOUBLES,
]);

/** Performs whole-table checks that individual CreatePacket calls cannot see. */
export function ValidatePacketSchema(
    packets: readonly Packet<any>[],
    options: { direction?: "client" | "server"; warnUnbounded?: boolean } = {},
): SchemaValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    const tags = new Set<string>();
    const parents = new Map<string, Packet<any>>();
    const variants = new Set<string>();

    if (packets.length > 254) {
        errors.push(`Packet table contains ${packets.length} packets; the maximum is 254`);
    }

    for (const packet of packets) {
        if (tags.has(packet.tag)) {
            errors.push(`Duplicate packet tag "${packet.tag}"`);
        }
        tags.add(packet.tag);

        if (packet.isParent) {
            parents.set(packet.tag, packet);
        }
        if (packet.replay && packet.dataBatching) {
            errors.push(`Packet "${packet.tag}" combines replay with batching`);
        }

        const types = Array.isArray(packet.type) ? packet.type : [packet.type];
        if (packet.quantized && types.some(type => !NUMERIC.has(type))) {
            errors.push(`Packet "${packet.tag}" quantizes a non-numeric type`);
        }
        if (packet.valueMin !== undefined && packet.valueMin < 0 && types.some(type => UNSIGNED.has(type))) {
            errors.push(`Packet "${packet.tag}" has a negative minimum for an unsigned type`);
        }
        if (
            packet.fields
            && !packet.autoFlatten
            && !packet.object
            && packet.dataMin === packet.dataMax
            && packet.fields.length !== packet.dataMax
        ) {
            errors.push(`Packet "${packet.tag}" schema length does not match its fixed value count`);
        }
        const unbounded = Array.isArray(packet.dataMax)
            ? packet.dataMax.some(value => value >= 2_048_383)
            : packet.dataMax >= 2_048_383;
        if (options.warnUnbounded && options.direction === "client" && unbounded) {
            warnings.push(`Client packet "${packet.tag}" has an effectively unbounded value count`);
        }

        if (packet.parent && packet.variant) {
            const key = `${packet.parent}.${packet.variant}`;
            if (variants.has(key)) {
                errors.push(`Duplicate packet-group variant "${key}"`);
            }
            variants.add(key);
        }
    }

    for (const packet of packets) {
        if (!packet.parent) continue;
        const parent = parents.get(packet.parent);
        if (!parent) {
            errors.push(`Packet "${packet.tag}" references missing group parent "${packet.parent}"`);
        } else if (parent.type !== PacketType.NONE) {
            errors.push(`Packet-group parent "${packet.parent}" must use PacketType.NONE`);
        }
    }

    return { errors, warnings };
}

/** Throws when a packet table contains structural schema errors. */
export function AssertPacketSchema(
    packets: readonly Packet<any>[],
    options?: Parameters<typeof ValidatePacketSchema>[1],
): void {
    const result = ValidatePacketSchema(packets, options);
    if (result.errors.length) {
        throw new Error(`Invalid SonicWS packet schema:\n- ${result.errors.join("\n- ")}`);
    }

    for (const warning of result.warnings) {
        console.warn(`SonicWS schema warning: ${warning}`);
    }
}
