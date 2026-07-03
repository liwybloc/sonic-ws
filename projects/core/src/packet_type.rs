/*
 * Copyright (c) 2026 Lily (liwybloc)
 *
 * Licensed for personal, non-commercial use only.
 * Commercial use, redistribution, sublicensing, sale, rental, lease,
 * or inclusion in a paid product or service is prohibited without prior
 * written permission from the copyright holder.
 *
 * See the LICENSE file in the project root for the full license terms.
 *
 * License-Identifier: LicenseRef-Lily-Personal-NonCommercial-2026
 */

#[repr(u8)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PacketType {
    None = 0,
    Raw = 1,
    StringsAscii = 2,
    StringsUtf16 = 3,
    Enums = 4,
    Bytes = 5,
    UBytes = 6,
    Shorts = 7,
    UShorts = 8,
    VarInt = 9,
    UVarInt = 10,
    Deltas = 11,
    Floats = 12,
    Doubles = 13,
    Booleans = 14,
    Reserved15 = 15,
    Reserved16 = 16,
    Hex = 17,
}
