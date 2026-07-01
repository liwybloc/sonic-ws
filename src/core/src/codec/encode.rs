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
    Error, PacketDef, PacketType, Result, SchemaType, SonicValue,
    compression::gzip,
    primitives::{bools, floats, hex, strings, varint, zigzag},
};

fn values(value: &SonicValue) -> &[SonicValue] {
    if let SonicValue::Array(v) = value {
        v
    } else {
        std::slice::from_ref(value)
    }
}
fn integer(v: &SonicValue) -> Result<i64> {
    match v {
        SonicValue::I64(n) => Ok(*n),
        SonicValue::U64(n) => i64::try_from(*n).map_err(|_| Error::InvalidData("integer overflow")),
        _ => Err(Error::InvalidData("expected integer")),
    }
}
fn unsigned(v: &SonicValue) -> Result<u64> {
    match v {
        SonicValue::U64(n) => Ok(*n),
        SonicValue::I64(n) => {
            u64::try_from(*n).map_err(|_| Error::InvalidData("negative unsigned integer"))
        }
        _ => Err(Error::InvalidData("expected unsigned integer")),
    }
}
fn encode_type(
    kind: PacketType,
    value: &SonicValue,
    enums: Option<&crate::enums::EnumPackage>,
) -> Result<Vec<u8>> {
    let vals = values(value);
    let mut out = vec![];
    match kind {
        PacketType::None => {
            if !matches!(value, SonicValue::Undefined | SonicValue::Null)
                && !matches!(value, SonicValue::Array(values) if values.is_empty())
            {
                return Err(Error::InvalidData(
                    "NONE only accepts undefined, null, or an empty value list",
                ));
            }
        }
        PacketType::Raw | PacketType::Reserved16 => {
            if let SonicValue::Bytes(v) = value {
                out = v.clone()
            } else {
                return Err(Error::InvalidData("expected bytes"));
            }
        }
        PacketType::Bytes => {
            for v in vals {
                out.push(
                    u8::try_from(zigzag::encode(integer(v)?))
                        .map_err(|_| Error::InvalidData("signed byte overflow"))?,
                )
            }
        }
        PacketType::UBytes => {
            for v in vals {
                out.push(
                    u8::try_from(unsigned(v)?).map_err(|_| Error::InvalidData("byte overflow"))?,
                )
            }
        }
        PacketType::Shorts => {
            for v in vals {
                out.extend(
                    u16::try_from(zigzag::encode(integer(v)?))
                        .map_err(|_| Error::InvalidData("signed short overflow"))?
                        .to_be_bytes(),
                )
            }
        }
        PacketType::UShorts => {
            for v in vals {
                out.extend(
                    u16::try_from(unsigned(v)?)
                        .map_err(|_| Error::InvalidData("short overflow"))?
                        .to_be_bytes(),
                )
            }
        }
        PacketType::VarInt => {
            for v in vals {
                out.extend(varint::encode(zigzag::encode(integer(v)?)))
            }
        }
        PacketType::UVarInt => {
            for v in vals {
                out.extend(varint::encode(unsigned(v)?))
            }
        }
        PacketType::Deltas => {
            let mut prev = 0;
            for v in vals {
                let n = integer(v)?;
                out.extend(varint::encode(zigzag::encode(n - prev)));
                prev = n
            }
        }
        PacketType::Floats => {
            for v in vals {
                let n = match v {
                    SonicValue::F32(n) => *n,
                    SonicValue::F64(n) => *n as f32,
                    _ => return Err(Error::InvalidData("expected float")),
                };
                out.extend(floats::encode_f32(n))
            }
        }
        PacketType::Doubles => {
            for v in vals {
                let n = match v {
                    SonicValue::F64(n) => *n,
                    SonicValue::F32(n) => *n as f64,
                    _ => return Err(Error::InvalidData("expected double")),
                };
                out.extend(floats::encode_f64(n))
            }
        }
        PacketType::Booleans => {
            let values = vals
                .iter()
                .map(|value| {
                    if let SonicValue::Bool(value) = value {
                        Ok(*value)
                    } else {
                        Err(Error::InvalidData("expected boolean"))
                    }
                })
                .collect::<Result<Vec<_>>>()?;
            out = bools::encode(&values)
        }
        PacketType::StringsAscii => {
            out = strings::encode_ascii(
                &vals
                    .iter()
                    .map(|v| {
                        if let SonicValue::String(s) = v {
                            Ok(s.clone())
                        } else {
                            Err(Error::InvalidData("expected string"))
                        }
                    })
                    .collect::<Result<Vec<_>>>()?,
            )?
        }
        PacketType::StringsUtf16 => {
            out = strings::encode_codepoints(
                &vals
                    .iter()
                    .map(|v| {
                        if let SonicValue::String(s) = v {
                            Ok(s.clone())
                        } else {
                            Err(Error::InvalidData("expected string"))
                        }
                    })
                    .collect::<Result<Vec<_>>>()?,
            )
        }
        PacketType::Hex => {
            if let SonicValue::String(s) = value {
                out = hex::decode(s)?
            } else {
                return Err(Error::InvalidData("expected hex string"));
            }
        }
        PacketType::Enums => {
            let package = enums.ok_or(Error::InvalidData("missing enum package"))?;
            for v in vals {
                let enum_value = crate::enums::EnumValue::from_sonic(v)?;
                out.push(
                    package
                        .values
                        .iter()
                        .position(|x| x == &enum_value)
                        .ok_or(Error::InvalidData("unknown enum value"))? as u8,
                )
            }
        }
        PacketType::KeyEffective => {
            return Err(Error::Unsupported(
                "KEY_EFFECTIVE is also W.I.P. in TypeScript",
            ));
        }
    }
    Ok(out)
}
pub fn encode_packet(packet: &PacketDef, value: &SonicValue) -> Result<Vec<u8>> {
    let mut out = match &packet.schema.packet_type {
        SchemaType::Single(t) => encode_type(*t, value, packet.enum_data.first())?,
        SchemaType::Object(types) => {
            let SonicValue::Array(fields) = value else {
                return Err(Error::InvalidData("expected object field array"));
            };
            if fields.len() != types.len() {
                return Err(Error::InvalidData("object field count mismatch"));
            }
            let mut out = vec![];
            let mut ei = 0;
            for (t, v) in types.iter().zip(fields) {
                let e = if *t == PacketType::Enums {
                    let x = packet.enum_data.get(ei);
                    ei += 1;
                    x
                } else {
                    None
                };
                let data = encode_type(*t, v, e)?;
                out.extend(varint::encode(data.len() as u64));
                out.extend(data)
            }
            out
        }
    };
    if matches!(packet.schema.packet_type, SchemaType::Single(_))
        && packet.schema.gzip_compression
        && packet.schema.data_batching == 0
    {
        out = gzip::compress(&out)?
    }
    Ok(out)
}
