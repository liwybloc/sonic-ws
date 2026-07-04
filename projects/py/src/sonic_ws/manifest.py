from .version import VERSION
from .packets import Packet, varint, read_varint

MAGIC = b"SWSM"


def create_packet_manifest(*, client_packets=(), server_packets=()):
    clients = b"".join(packet.serialize() for packet in client_packets)
    servers = b"".join(packet.serialize() for packet in server_packets)
    return MAGIC + bytes([VERSION]) + varint(len(clients)) + clients + servers


def _deserialize_all(data):
    result, offset = [], 0
    while offset < len(data):
        packet, consumed = Packet.deserialize(data, offset, False)
        result.append(packet)
        offset += consumed
    return result


def load_packet_manifest(data):
    data = bytes(data)
    if len(data) < 6 or data[:4] != MAGIC:
        raise ValueError("invalid SonicWS packet manifest")
    if data[4] != VERSION:
        raise ValueError(f"packet manifest protocol mismatch: {data[4]} != {VERSION}")
    offset, client_length = read_varint(data, 5)
    end = offset + client_length
    if end > len(data):
        raise ValueError("truncated SonicWS packet manifest")
    return {
        "client_packets": _deserialize_all(data[offset:end]),
        "server_packets": _deserialize_all(data[end:]),
    }


CreatePacketManifest = create_packet_manifest
LoadPacketManifest = load_packet_manifest
