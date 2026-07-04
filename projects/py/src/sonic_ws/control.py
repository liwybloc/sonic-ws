from .jsonutil import compress_json, decompress_json
from .packets import varint, read_varint

CONTROL_KEY = 0
REQUEST = 1
RESPONSE = 2
REPLAY = 3
RESUME = 4
RESUMED = 5


def encode_request(identifier, packet_key, payload):
    return (
        bytes([CONTROL_KEY, REQUEST])
        + varint(identifier)
        + bytes([packet_key])
        + bytes(payload)
    )


def encode_response(identifier, ok, value):
    return (
        bytes([CONTROL_KEY, RESPONSE])
        + varint(identifier)
        + bytes([bool(ok)])
        + compress_json(value)
    )


def encode_replay(sequence, payload):
    return bytes([CONTROL_KEY, REPLAY]) + varint(sequence) + bytes(payload)


def encode_resume(session_id, last_sequence):
    session = session_id.encode()
    return (
        bytes([CONTROL_KEY, RESUME])
        + varint(len(session))
        + session
        + varint(last_sequence)
    )


def encode_resumed(recovered, replayed):
    return bytes([CONTROL_KEY, RESUMED, bool(recovered)]) + varint(replayed)


def decode_control(data):
    data = bytes(data)
    if len(data) < 3 or data[0] != CONTROL_KEY:
        raise ValueError("invalid SonicWS control frame")
    kind = data[1]
    if kind == REPLAY:
        offset, sequence = read_varint(data, 2)
        return kind, sequence, data[offset:]
    if kind == RESUME:
        offset, length = read_varint(data, 2)
        end = offset + length
        if end > len(data):
            raise ValueError("recovery frame has an invalid session id")
        _, last_sequence = read_varint(data, end)
        return kind, data[offset:end].decode(), last_sequence
    if kind == RESUMED:
        if len(data) < 4:
            raise ValueError("invalid recovery result frame")
        _, replayed = read_varint(data, 3)
        return kind, bool(data[2]), replayed
    offset, identifier = read_varint(data, 2)
    if kind == REQUEST:
        if offset >= len(data):
            raise ValueError("RPC request is missing its packet key")
        return kind, identifier, data[offset], data[offset + 1 :]
    if kind == RESPONSE:
        if offset >= len(data):
            raise ValueError("RPC response is missing its status")
        return kind, identifier, bool(data[offset]), decompress_json(data[offset + 1 :])
    raise ValueError(f"unknown SonicWS control frame type: {kind}")
