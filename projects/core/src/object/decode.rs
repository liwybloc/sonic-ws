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

use crate::{Error, PacketDef, Result, SchemaType, SonicValue, codec::decode::decode_packet};

pub fn decode(packet: &PacketDef, bytes: &[u8]) -> Result<Vec<SonicValue>> {
    if !packet.schema.object || !matches!(packet.schema.packet_type, SchemaType::Object(_)) {
        return Err(Error::InvalidData("packet is not an object schema"));
    }
    match decode_packet(packet, bytes)? {
        SonicValue::Array(fields) => Ok(fields),
        _ => Err(Error::InvalidData("object decoder returned invalid value")),
    }
}
