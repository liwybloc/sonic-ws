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

use crate::{Error, Result};

pub fn encode_i16(value: i16) -> [u8; 2] {
    value.to_be_bytes()
}
pub fn encode_u16(value: u16) -> [u8; 2] {
    value.to_be_bytes()
}

pub fn decode_i16(bytes: &[u8]) -> Result<i16> {
    bytes
        .try_into()
        .map(i16::from_be_bytes)
        .map_err(|_| Error::InvalidData("i16 requires two bytes"))
}

pub fn decode_u16(bytes: &[u8]) -> Result<u16> {
    bytes
        .try_into()
        .map(u16::from_be_bytes)
        .map_err(|_| Error::InvalidData("u16 requires two bytes"))
}
