from .packet_type import PacketType

UNSIGNED = {PacketType.UBYTES, PacketType.USHORTS, PacketType.UVARINT}
NUMERIC = {
    PacketType.BYTES, PacketType.UBYTES, PacketType.SHORTS, PacketType.USHORTS,
    PacketType.VARINT, PacketType.UVARINT, PacketType.DELTAS,
    PacketType.FLOATS, PacketType.DOUBLES,
}


def validate_packet_schema(packets, *, direction=None, warn_unbounded=False):
    packets = list(packets)
    errors, warnings = [], []
    tags, variants = set(), set()
    parents = {packet.tag: packet for packet in packets if packet.is_parent}
    if len(packets) > 254:
        errors.append(f"packet table contains {len(packets)} packets; the maximum is 254")

    for packet in packets:
        if packet.tag in tags:
            errors.append(f'duplicate packet tag "{packet.tag}"')
        tags.add(packet.tag)
        if packet.replay and packet.data_batching:
            errors.append(f'packet "{packet.tag}" combines replay with batching')
        if packet.quantized and any(kind not in NUMERIC for kind in packet.types):
            errors.append(f'packet "{packet.tag}" quantizes a non-numeric type')
        if packet.value_min is not None and packet.value_min < 0 and any(kind in UNSIGNED for kind in packet.types):
            errors.append(f'packet "{packet.tag}" has a negative minimum for an unsigned type')
        if warn_unbounded and direction == "client" and any(value >= 2_048_383 for value in packet.data_maxes):
            warnings.append(f'client packet "{packet.tag}" has an effectively unbounded value count')
        if packet.parent and packet.variant:
            key = f"{packet.parent}.{packet.variant}"
            if key in variants:
                errors.append(f'duplicate packet-group variant "{key}"')
            variants.add(key)

    for packet in packets:
        if not packet.parent:
            continue
        parent = parents.get(packet.parent)
        if parent is None:
            errors.append(f'packet "{packet.tag}" references missing group parent "{packet.parent}"')
        elif parent.type != PacketType.NONE:
            errors.append(f'packet-group parent "{packet.parent}" must use PacketType.NONE')
    return {"errors": errors, "warnings": warnings}


def assert_packet_schema(packets, **options):
    result = validate_packet_schema(packets, **options)
    if result["errors"]:
        raise ValueError("invalid SonicWS packet schema:\n- " + "\n- ".join(result["errors"]))
    return result


ValidatePacketSchema = validate_packet_schema
AssertPacketSchema = assert_packet_schema
