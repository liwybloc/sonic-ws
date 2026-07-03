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

from enum import IntEnum


class PacketType(IntEnum):
    NONE = 0
    RAW = 1
    STRINGS_ASCII = 2
    STRINGS_UTF16 = 3
    STRINGS = 2
    ENUMS = 4
    BYTES = 5
    UBYTES = 6
    SHORTS = 7
    USHORTS = 8
    VARINT = 9
    UVARINT = 10
    DELTAS = 11
    FLOATS = 12
    DOUBLES = 13
    BOOLEANS = 14
    JSON = 16
    HEX = 17
