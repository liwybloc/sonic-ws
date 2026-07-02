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

use crate::{Error, PacketDef, Result, compression::gzip, primitives::varint, wire::Reader};

pub fn decode_batches(bytes: &[u8]) -> Result<Vec<Vec<u8>>> {
    decode_batches_limited(bytes, 0)
}

/// Decodes framed payloads. A limit of zero means unlimited.
pub fn decode_batches_limited(bytes: &[u8], max_batch_size: usize) -> Result<Vec<Vec<u8>>> {
    let mut reader = Reader::new(bytes);
    let mut batches = Vec::new();
    while !reader.is_empty() {
        if max_batch_size > 0 && batches.len() >= max_batch_size {
            return Err(Error::InvalidData("batch exceeds max_batch_size"));
        }
        let length = usize::try_from(varint::decode(&mut reader)?)
            .map_err(|_| Error::InvalidData("batch length exceeds platform size"))?;
        batches.push(reader.read_exact(length)?.to_vec());
    }
    Ok(batches)
}

pub fn decode_for_packet(packet: &PacketDef, bytes: &[u8]) -> Result<Vec<Vec<u8>>> {
    let decoded = if packet.schema.gzip_compression {
        gzip::decompress_for_packet(packet, bytes, true)?
    } else {
        bytes.to_vec()
    };
    let limit = if packet.schema.max_batch_size <= 0 {
        0
    } else {
        packet.schema.max_batch_size as usize
    };
    decode_batches_limited(&decoded, limit)
}
