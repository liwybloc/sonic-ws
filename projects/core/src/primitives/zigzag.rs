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

pub fn encode(value: i64) -> u64 {
    let value = value as i32;
    ((value << 1) ^ (value >> 31)) as u32 as u64
}
pub fn decode(value: u64) -> i64 {
    let value = value as u32;
    ((value >> 1) as i32 ^ -((value & 1) as i32)) as i64
}
