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
    Error, PacketDef, PacketType, Result, SchemaLimit, SchemaType, SonicValue,
    compression::gzip,
    primitives::{bools, floats, hex, strings, varint, zigzag},
    wire::Reader,
};

fn decode_type(
    kind: PacketType,
    bytes: &[u8],
    cap: u64,
    enums: Option<&crate::enums::EnumPackage>,
) -> Result<SonicValue> {
    let array = |values| Ok(SonicValue::Array(values));
    match kind {
        PacketType::None => {
            if bytes.is_empty() {
                Ok(SonicValue::Undefined)
            } else {
                Err(Error::InvalidData("NONE sector is not empty"))
            }
        }
        PacketType::Raw | PacketType::Reserved16 => Ok(SonicValue::Bytes(bytes.to_vec())),
        PacketType::Bytes => array(
            bytes
                .iter()
                .map(|v| SonicValue::I64(zigzag::decode(u64::from(*v))))
                .collect(),
        ),
        PacketType::UBytes => array(
            bytes
                .iter()
                .map(|v| SonicValue::U64(u64::from(*v)))
                .collect(),
        ),
        PacketType::Shorts | PacketType::UShorts => {
            if !bytes.len().is_multiple_of(2) {
                return Err(Error::InvalidData("truncated short"));
            }
            let values = bytes
                .chunks_exact(2)
                .map(|v| {
                    let n = u16::from_be_bytes([v[0], v[1]]);
                    if kind == PacketType::Shorts {
                        SonicValue::I64(zigzag::decode(u64::from(n)))
                    } else {
                        SonicValue::U64(u64::from(n))
                    }
                })
                .collect();
            array(values)
        }
        PacketType::VarInt | PacketType::UVarInt | PacketType::Deltas => {
            let mut reader = Reader::new(bytes);
            let mut values = vec![];
            let mut previous = 0_i64;
            while !reader.is_empty() {
                let n = varint::decode(&mut reader)?;
                let value = if kind == PacketType::UVarInt {
                    SonicValue::U64(n)
                } else if kind == PacketType::Deltas {
                    previous += zigzag::decode(n);
                    SonicValue::I64(previous)
                } else {
                    SonicValue::I64(zigzag::decode(n))
                };
                values.push(value)
            }
            array(values)
        }
        PacketType::Floats => {
            if !bytes.len().is_multiple_of(4) {
                return Err(Error::InvalidData("truncated float"));
            }
            array(
                bytes
                    .chunks_exact(4)
                    .map(|v| SonicValue::F32(floats::decode_f32(v.try_into().unwrap())))
                    .collect(),
            )
        }
        PacketType::Doubles => {
            if !bytes.len().is_multiple_of(8) {
                return Err(Error::InvalidData("truncated double"));
            }
            array(
                bytes
                    .chunks_exact(8)
                    .map(|v| SonicValue::F64(floats::decode_f64(v.try_into().unwrap())))
                    .collect(),
            )
        }
        PacketType::Booleans => array(
            bools::decode(bytes, usize::try_from(cap).unwrap_or(usize::MAX))
                .into_iter()
                .map(SonicValue::Bool)
                .collect(),
        ),
        PacketType::StringsAscii => array(
            strings::decode_ascii(bytes)?
                .into_iter()
                .map(SonicValue::String)
                .collect(),
        ),
        PacketType::StringsUtf16 => array(
            strings::decode_codepoints(bytes)?
                .into_iter()
                .map(SonicValue::String)
                .collect(),
        ),
        PacketType::Hex => Ok(SonicValue::String(hex::encode(bytes))),
        PacketType::Enums => {
            let package = enums.ok_or(Error::InvalidData("missing enum package"))?;
            array(
                bytes
                    .iter()
                    .map(|index| {
                        package
                            .values
                            .get(*index as usize)
                            .map(crate::enums::EnumValue::to_sonic)
                            .ok_or(Error::InvalidData("enum index out of range"))
                    })
                    .collect::<Result<Vec<_>>>()?,
            )
        }
    }
}

pub fn decode_packet(packet: &PacketDef, bytes: &[u8]) -> Result<SonicValue> {
    let data = if matches!(packet.schema.packet_type, SchemaType::Single(_))
        && packet.schema.gzip_compression
        && packet.schema.data_batching == 0
    {
        gzip::decompress_for_packet(packet, bytes, false)?
    } else {
        bytes.to_vec()
    };
    match (&packet.schema.packet_type, &packet.schema.data_max) {
        (SchemaType::Single(kind), SchemaLimit::Single(cap)) => {
            decode_type(*kind, &data, *cap, packet.enum_data.first())
        }
        (SchemaType::Object(types), SchemaLimit::Object(caps)) => {
            if types.len() != caps.len() {
                return Err(Error::InvalidData("object schema length mismatch"));
            }
            let mut reader = Reader::new(&data);
            let mut fields = Vec::with_capacity(types.len());
            let mut enum_index = 0;
            for (kind, cap) in types.iter().zip(caps) {
                if reader.is_empty() {
                    return Err(Error::InvalidData("missing object sector"));
                }
                let len = varint::decode(&mut reader)? as usize;
                let sector = reader.read_exact(len)?;
                let package = if *kind == PacketType::Enums {
                    let p = packet.enum_data.get(enum_index);
                    enum_index += 1;
                    p
                } else {
                    None
                };
                fields.push(decode_type(*kind, sector, *cap, package)?)
            }
            if !reader.is_empty() {
                return Err(Error::InvalidData("extra object sector"));
            }
            Ok(SonicValue::Array(fields))
        }
        _ => Err(Error::InvalidData("schema type and limits do not match")),
    }
}
