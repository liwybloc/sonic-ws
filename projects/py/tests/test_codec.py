# Copyright (c) 2026 Lily (liwybloc)
#
# Licensed for personal, non-commercial use only.
# Commercial use, redistribution, sublicensing, sale, rental, lease,
# or inclusion in a paid product or service is prohibited without prior
# written permission from the copyright holder.
#
# See the LICENSE file in the project root for the full license terms.
#
# License-Identifier: LicenseRef-Lily-Personal-NonCommercial-2026

from sonic_ws import PacketType
from sonic_ws.codec import encode_value, decode_value, encode_batch, decode_batch
from sonic_ws.jsonutil import compress_json, decompress_json

cases = [
    (PacketType.BYTES, [-128, -1, 0, 1, 127]),
    (PacketType.UVARINT, [0, 127, 128, 4294967295]),
    (PacketType.STRINGS_ASCII, ["hello", "world"]),
    (PacketType.STRINGS_UTF16, ["😂", "𐍈"]),
    (PacketType.BOOLEANS, [True, False, True]),
]

print("Testing encode_value/decode_value...")

for kind, value in cases:
    encoded = encode_value(kind, value)
    decoded = decode_value(kind, encoded, len(value))

    print(f"\nPacket type: {kind.name}")
    print(f"Original:    {value}")
    print(f"Encoded:     {encoded.hex()}")
    print(f"Decoded:     {decoded}")

    assert decoded == value

print("\nTesting encode_batch/decode_batch...")

payloads = [b"a", b"", b"xyz"]
encoded_batch = encode_batch(payloads, True)
decoded_batch = decode_batch(encoded_batch, True)

print(f"Original payloads: {payloads}")
print(f"Encoded batch:     {encoded_batch.hex()}")
print(f"Decoded payloads:  {decoded_batch}")

assert decoded_batch == payloads

print("\nTesting compress_json/decompress_json...")

value = {"ok": True, "n": -12, "text": "Sonic", "list": [None, 1.5, False]}
encoded = compress_json(value)
decoded = decompress_json(encoded)

expected_hex = "010380c54a1904026f6b016e17047465787405536f6e6963046c697374033fc00000"

print(f"Original JSON: {value}")
print(f"Encoded Object:  {encoded.hex()}")
print(f"Expected hex:  {expected_hex}")
print(f"Decoded Object:  {decoded}")

assert encoded.hex() == expected_hex
assert decoded == value

print("\nAll tests passed.")
