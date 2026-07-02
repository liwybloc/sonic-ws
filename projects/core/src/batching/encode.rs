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

use crate::{PacketDef, Result, compression::gzip, primitives::varint};

/// Frames already-encoded packet payloads as `[varint length][payload]...`.
pub fn encode_batches(batches: &[Vec<u8>]) -> Result<Vec<u8>> {
    let capacity = batches.iter().map(|batch| batch.len() + 10).sum();
    let mut output = Vec::with_capacity(capacity);
    for batch in batches {
        output.extend(varint::encode(batch.len() as u64));
        output.extend(batch);
    }
    Ok(output)
}

/// Applies the whole-batch raw-deflate behavior used by TypeScript.
pub fn encode_for_packet(packet: &PacketDef, batches: &[Vec<u8>]) -> Result<Vec<u8>> {
    let encoded = encode_batches(batches)?;
    if packet.schema.gzip_compression {
        gzip::compress(&encoded)
    } else {
        Ok(encoded)
    }
}
