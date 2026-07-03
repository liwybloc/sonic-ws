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

use crate::{
    Error, PacketDef, PacketType, Result, SchemaLimit, SchemaType, batching,
    compression::gzip,
    primitives::{strings, varint},
    wire::Reader,
};

fn in_range(count: usize, min: u64, max: u64) -> Result<()> {
    let count = count as u64;
    if count < min || count > max {
        Err(Error::InvalidData(
            "packet value count is outside schema limits",
        ))
    } else {
        Ok(())
    }
}

fn validate_type(
    kind: PacketType,
    bytes: &[u8],
    min: u64,
    max: u64,
    enums: Option<&crate::enums::EnumPackage>,
) -> Result<()> {
    match kind {
        PacketType::None => {
            if bytes.is_empty() {
                Ok(())
            } else {
                Err(Error::InvalidData("NONE packet contains data"))
            }
        }
        PacketType::Raw | PacketType::Reserved16 => Ok(()),
        PacketType::Bytes | PacketType::UBytes | PacketType::Hex => in_range(bytes.len(), min, max),
        PacketType::Enums => {
            in_range(bytes.len(), min, max)?;
            let package = enums.ok_or(Error::InvalidData("missing enum package"))?;
            if bytes
                .iter()
                .all(|index| (*index as usize) < package.values.len())
            {
                Ok(())
            } else {
                Err(Error::InvalidData("enum index is out of range"))
            }
        }
        PacketType::Shorts | PacketType::UShorts => {
            if !bytes.len().is_multiple_of(2) {
                return Err(Error::InvalidData("short packet has an odd byte count"));
            }
            in_range(bytes.len() / 2, min, max)
        }
        PacketType::VarInt | PacketType::UVarInt | PacketType::Deltas => {
            let mut reader = Reader::new(bytes);
            let mut count = 0;
            while !reader.is_empty() {
                varint::decode(&mut reader)?;
                count += 1;
                if count as u64 > max {
                    return Err(Error::InvalidData(
                        "packet value count exceeds schema maximum",
                    ));
                }
            }
            in_range(count, min, max)
        }
        PacketType::Floats => {
            if !bytes.len().is_multiple_of(4) {
                return Err(Error::InvalidData("float packet is not four-byte aligned"));
            }
            in_range(bytes.len() / 4, min, max)
        }
        PacketType::Doubles => {
            if !bytes.len().is_multiple_of(8) {
                return Err(Error::InvalidData(
                    "double packet is not eight-byte aligned",
                ));
            }
            in_range(bytes.len() / 8, min, max)
        }
        PacketType::Booleans => {
            let min_bytes = min.div_ceil(8);
            let max_bytes = max.div_ceil(8);
            let len = bytes.len() as u64;
            if len < min_bytes || len > max_bytes {
                Err(Error::InvalidData(
                    "boolean packet byte count is outside schema limits",
                ))
            } else {
                Ok(())
            }
        }
        PacketType::StringsAscii => {
            let mut reader = Reader::new(bytes);
            let count = varint::decode(&mut reader)?;
            if count < min || count > max {
                return Err(Error::InvalidData("string count is outside schema limits"));
            }
            let mut total = 0_u64;
            for _ in 0..count {
                total = total
                    .checked_add(varint::decode(&mut reader)?)
                    .ok_or(Error::InvalidData("string lengths overflow"))?;
            }
            if (reader.remaining() as u64) < total.div_ceil(8) {
                return Err(Error::InvalidData("truncated Huffman string payload"));
            }
            let decoded = strings::decode_ascii(bytes)?;
            let decoded_total = decoded
                .iter()
                .map(|value| value.chars().count())
                .sum::<usize>();
            if decoded_total != total as usize {
                Err(Error::InvalidData("Huffman string length mismatch"))
            } else {
                Ok(())
            }
        }
        PacketType::StringsUtf16 => {
            let mut reader = Reader::new(bytes);
            let mut count = 0_u64;
            while !reader.is_empty() {
                count += 1;
                if count > max {
                    return Err(Error::InvalidData("string count exceeds schema maximum"));
                }
                let chars = varint::decode(&mut reader)?;
                for _ in 0..chars {
                    let code = varint::decode(&mut reader)?;
                    if char::from_u32(code as u32).is_none() {
                        return Err(Error::InvalidData("invalid Unicode code point"));
                    }
                }
            }
            if count < min {
                Err(Error::InvalidData("string count is below schema minimum"))
            } else {
                Ok(())
            }
        }
    }
}

pub fn validate_packet(packet: &PacketDef, bytes: &[u8]) -> Result<()> {
    let data = if matches!(packet.schema.packet_type, SchemaType::Single(_))
        && packet.schema.gzip_compression
        && packet.schema.data_batching == 0
    {
        gzip::decompress_for_packet(packet, bytes, false)?
    } else {
        bytes.to_vec()
    };
    match (
        &packet.schema.packet_type,
        &packet.schema.data_min,
        &packet.schema.data_max,
    ) {
        (SchemaType::Single(kind), SchemaLimit::Single(min), SchemaLimit::Single(max)) => {
            validate_type(*kind, &data, *min, *max, packet.enum_data.first())
        }
        (SchemaType::Object(types), SchemaLimit::Object(mins), SchemaLimit::Object(maxes)) => {
            if types.len() != mins.len() || types.len() != maxes.len() {
                return Err(Error::InvalidData("object schema length mismatch"));
            }
            let mut reader = Reader::new(&data);
            let mut enum_index = 0;
            for ((kind, min), max) in types.iter().zip(mins).zip(maxes) {
                if reader.is_empty() {
                    return Err(Error::InvalidData("missing object sector"));
                }
                let length = usize::try_from(varint::decode(&mut reader)?).map_err(|_| {
                    Error::InvalidData("object sector length exceeds platform size")
                })?;
                let sector = reader.read_exact(length)?;
                let package = if *kind == PacketType::Enums {
                    let package = packet.enum_data.get(enum_index);
                    enum_index += 1;
                    package
                } else {
                    None
                };
                validate_type(*kind, sector, *min, *max, package)?;
            }
            if !reader.is_empty() {
                return Err(Error::InvalidData("extra object sector"));
            }
            Ok(())
        }
        _ => Err(Error::InvalidData("schema types and limits do not match")),
    }
}

/// Unravels a TypeScript batch and validates every encoded packet payload.
pub fn validate_batched(packet: &PacketDef, bytes: &[u8]) -> Result<()> {
    if packet.schema.data_batching == 0 {
        return Err(Error::InvalidData("packet is not configured for batching"));
    }
    let batches = batching::decode_for_packet(packet, bytes)?;
    let mut single = packet.clone();
    single.schema.data_batching = 0;
    single.schema.gzip_compression = false;
    for payload in batches {
        validate_packet(&single, &payload)?;
    }
    Ok(())
}
