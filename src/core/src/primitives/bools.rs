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

pub fn encode(values: &[bool]) -> Vec<u8> {
    values
        .chunks(8)
        .map(|chunk| {
            chunk
                .iter()
                .enumerate()
                .fold(0, |byte, (bit, value)| byte | ((*value as u8) << (7 - bit)))
        })
        .collect()
}

pub fn decode(bytes: &[u8], count: usize) -> Vec<bool> {
    (0..count)
        .map(|index| {
            bytes
                .get(index / 8)
                .is_some_and(|byte| byte & (1 << (7 - index % 8)) != 0)
        })
        .collect()
}
