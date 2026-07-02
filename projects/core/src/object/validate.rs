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

use crate::{Error, PacketDef, Result, SchemaType, codec::validate::validate_packet};

pub fn validate(packet: &PacketDef, bytes: &[u8]) -> Result<()> {
    if !packet.schema.object || !matches!(packet.schema.packet_type, SchemaType::Object(_)) {
        return Err(Error::InvalidData("packet is not an object schema"));
    }
    validate_packet(packet, bytes)
}
