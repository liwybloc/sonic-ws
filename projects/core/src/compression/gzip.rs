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

use crate::{Error, PacketDef, PacketType, Result, SchemaLimit, SchemaType};
use flate2::{Compression, read::DeflateDecoder, write::DeflateEncoder};
use std::io::{Read, Write};

// the legacy schema calls this "gzip" but SonicWS uses a raw DEFLATE stream
// without a gzip container or header.
pub const MAX_DECOMPRESSED_SIZE: usize = 16 * 1024 * 1024;

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
    decompress_limited(bytes, MAX_DECOMPRESSED_SIZE)
}

/// Inflates at most `max_output_size` bytes. Reading one additional byte lets
/// us reject oversized streams without ever materializing their full output.
pub fn decompress_limited(bytes: &[u8], max_output_size: usize) -> Result<Vec<u8>> {
    let decoder = DeflateDecoder::new(bytes);
    let read_limit = max_output_size
        .checked_add(1)
        .ok_or(Error::InvalidData("decompression limit is too large"))?;
    let mut result = Vec::with_capacity(bytes.len().min(max_output_size));
    decoder
        .take(read_limit as u64)
        .read_to_end(&mut result)
        .map_err(|_| Error::InvalidData("invalid raw deflate stream"))?;
    if result.len() > max_output_size {
        return Err(Error::InvalidData("decompressed data exceeds limit"));
    }
    Ok(result)
}

fn encoded_size_limit(kind: PacketType, values: u64) -> Option<u64> {
    match kind {
        PacketType::None => Some(0),
        PacketType::Raw
        | PacketType::Bytes
        | PacketType::UBytes
        | PacketType::Enums
        | PacketType::Hex => Some(values),
        PacketType::Shorts | PacketType::UShorts => values.checked_mul(2),
        PacketType::VarInt | PacketType::UVarInt | PacketType::Deltas => values.checked_mul(10),
        PacketType::Floats => values.checked_mul(4),
        PacketType::Doubles => values.checked_mul(8),
        PacketType::Booleans => values.checked_add(7).map(|value| value / 8),
        PacketType::StringsAscii | PacketType::StringsUtf16 | PacketType::Reserved16 => None,
    }
}

/// Uses schema bounds when they describe a maximum encoded size, while always
/// enforcing the global ceiling for variable-width and application codecs.
pub fn decompress_for_packet(packet: &PacketDef, bytes: &[u8], batched: bool) -> Result<Vec<u8>> {
    let schema_limit = match (&packet.schema.packet_type, &packet.schema.data_max) {
        (SchemaType::Single(kind), SchemaLimit::Single(max)) => encoded_size_limit(*kind, *max)
            .and_then(|payload| {
                if batched {
                    let count = u64::try_from(packet.schema.max_batch_size).ok()?;
                    if count == 0 {
                        None
                    } else {
                        payload.checked_add(10)?.checked_mul(count)
                    }
                } else {
                    Some(payload)
                }
            }),
        _ => None,
    };
    let limit = schema_limit
        .and_then(|value| usize::try_from(value).ok())
        .unwrap_or(MAX_DECOMPRESSED_SIZE)
        .min(MAX_DECOMPRESSED_SIZE);
    decompress_limited(bytes, limit)
}
