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
use flate2::{Compression, read::DeflateDecoder, write::DeflateEncoder};
use std::io::{Read, Write};

// The legacy schema calls this "gzip", but SonicWS uses a raw DEFLATE stream
// without a gzip container or header.
pub fn compress(bytes: &[u8]) -> Result<Vec<u8>> {
    let mut encoder = DeflateEncoder::new(Vec::new(), Compression::default());
    encoder
        .write_all(bytes)
        .map_err(|_| Error::InvalidData("deflate compression failed"))?;
    encoder
        .finish()
        .map_err(|_| Error::InvalidData("deflate compression failed"))
}
pub fn decompress(bytes: &[u8]) -> Result<Vec<u8>> {
    let mut decoder = DeflateDecoder::new(bytes);
    let mut result = Vec::new();
    decoder
        .read_to_end(&mut result)
        .map_err(|_| Error::InvalidData("invalid raw deflate stream"))?;
    Ok(result)
}
