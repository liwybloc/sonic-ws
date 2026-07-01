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

use napi::{Error as NapiError, Result, bindgen_prelude::Buffer};
use napi_derive::napi;

use crate::{
    PacketDef, PacketSchema, PacketType, SchemaLimit, SchemaType, SonicValue, batching,
    codec::{
        decode::decode_packet,
        encode::encode_packet,
        validate::{validate_batched, validate_packet},
    },
    compression::gzip,
};

fn napi_error(error: crate::Error) -> NapiError {
    NapiError::from_reason(error.to_string())
}

fn packet_type(value: u8) -> Result<PacketType> {
    Ok(match value {
        0 => PacketType::None,
        1 => PacketType::Raw,
        2 => PacketType::StringsAscii,
        3 => PacketType::StringsUtf16,
        4 => PacketType::Enums,
        5 => PacketType::Bytes,
        6 => PacketType::UBytes,
        7 => PacketType::Shorts,
        8 => PacketType::UShorts,
        9 => PacketType::VarInt,
        10 => PacketType::UVarInt,
        11 => PacketType::Deltas,
        12 => PacketType::Floats,
        13 => PacketType::Doubles,
        14 => PacketType::Booleans,
        15 => PacketType::KeyEffective,
        16 => PacketType::Reserved16,
        17 => PacketType::Hex,
        _ => {
            return Err(NapiError::from_reason(format!(
                "unknown packet type {value}"
            )));
        }
    })
}

fn packet(kind: u8, cap: u32) -> Result<PacketDef> {
    Ok(PacketDef {
        tag: "ffi".into(),
        schema: PacketSchema {
            object: false,
            packet_type: SchemaType::Single(packet_type(kind)?),
            data_min: SchemaLimit::Single(0),
            data_max: SchemaLimit::Single(u64::from(cap)),
            data_batching: 0,
            max_batch_size: 0,
            dont_spread: false,
            auto_flatten: false,
            rereference: false,
            gzip_compression: false,
        },
        enum_data: vec![],
    })
}

fn encode(kind: u8, cap: u32, value: SonicValue) -> Result<Buffer> {
    encode_packet(&packet(kind, cap)?, &value)
        .map(Buffer::from)
        .map_err(napi_error)
}
fn decode(kind: u8, cap: u32, data: &[u8]) -> Result<SonicValue> {
    decode_packet(&packet(kind, cap)?, data).map_err(napi_error)
}

#[napi]
pub fn encode_signed(kind: u8, values: Vec<i32>) -> Result<Buffer> {
    let cap = values.len() as u32;
    encode(
        kind,
        cap,
        SonicValue::Array(
            values
                .into_iter()
                .map(|v| SonicValue::I64(i64::from(v)))
                .collect(),
        ),
    )
}
#[napi]
pub fn decode_signed(kind: u8, data: Buffer) -> Result<Vec<i32>> {
    match decode(kind, u32::MAX, &data)? {
        SonicValue::Array(v) => v
            .into_iter()
            .map(|v| {
                if let SonicValue::I64(n) = v {
                    i32::try_from(n)
                        .map_err(|_| NapiError::from_reason("decoded value exceeds i32"))
                } else {
                    Err(NapiError::from_reason(
                        "packet did not decode signed integers",
                    ))
                }
            })
            .collect(),
        _ => Err(NapiError::from_reason("packet did not decode an array")),
    }
}

#[napi]
pub fn encode_unsigned(kind: u8, values: Vec<u32>) -> Result<Buffer> {
    let cap = values.len() as u32;
    encode(
        kind,
        cap,
        SonicValue::Array(
            values
                .into_iter()
                .map(|v| SonicValue::U64(u64::from(v)))
                .collect(),
        ),
    )
}
#[napi]
pub fn decode_unsigned(kind: u8, data: Buffer) -> Result<Vec<u32>> {
    match decode(kind, u32::MAX, &data)? {
        SonicValue::Array(v) => v
            .into_iter()
            .map(|v| {
                if let SonicValue::U64(n) = v {
                    u32::try_from(n)
                        .map_err(|_| NapiError::from_reason("decoded value exceeds u32"))
                } else {
                    Err(NapiError::from_reason(
                        "packet did not decode unsigned integers",
                    ))
                }
            })
            .collect(),
        _ => Err(NapiError::from_reason("packet did not decode an array")),
    }
}

#[napi]
pub fn encode_floats(kind: u8, values: Vec<f64>) -> Result<Buffer> {
    let cap = values.len() as u32;
    let values = values
        .into_iter()
        .map(|v| {
            if kind == 12 {
                SonicValue::F32(v as f32)
            } else {
                SonicValue::F64(v)
            }
        })
        .collect();
    encode(kind, cap, SonicValue::Array(values))
}
#[napi]
pub fn decode_floats(kind: u8, data: Buffer) -> Result<Vec<f64>> {
    match decode(kind, u32::MAX, &data)? {
        SonicValue::Array(v) => v
            .into_iter()
            .map(|v| match v {
                SonicValue::F32(n) => Ok(f64::from(n)),
                SonicValue::F64(n) => Ok(n),
                _ => Err(NapiError::from_reason("packet did not decode floats")),
            })
            .collect(),
        _ => Err(NapiError::from_reason("packet did not decode an array")),
    }
}

#[napi]
pub fn encode_strings(kind: u8, values: Vec<String>) -> Result<Buffer> {
    let cap = values.len() as u32;
    encode(
        kind,
        cap,
        SonicValue::Array(values.into_iter().map(SonicValue::String).collect()),
    )
}
#[napi]
pub fn decode_strings(kind: u8, data: Buffer) -> Result<Vec<String>> {
    match decode(kind, u32::MAX, &data)? {
        SonicValue::Array(v) => v
            .into_iter()
            .map(|v| {
                if let SonicValue::String(s) = v {
                    Ok(s)
                } else {
                    Err(NapiError::from_reason("packet did not decode strings"))
                }
            })
            .collect(),
        _ => Err(NapiError::from_reason("packet did not decode an array")),
    }
}

#[napi]
pub fn encode_booleans(values: Vec<bool>) -> Result<Buffer> {
    let cap = values.len() as u32;
    encode(
        14,
        cap,
        SonicValue::Array(values.into_iter().map(SonicValue::Bool).collect()),
    )
}
#[napi]
pub fn decode_booleans(data: Buffer, count: u32) -> Result<Vec<bool>> {
    match decode(14, count, &data)? {
        SonicValue::Array(v) => v
            .into_iter()
            .map(|v| {
                if let SonicValue::Bool(b) = v {
                    Ok(b)
                } else {
                    Err(NapiError::from_reason("packet did not decode booleans"))
                }
            })
            .collect(),
        _ => Err(NapiError::from_reason("packet did not decode an array")),
    }
}

#[napi]
pub fn encode_raw(data: Buffer) -> Result<Buffer> {
    encode(1, data.len() as u32, SonicValue::Bytes(data.to_vec()))
}
#[napi]
pub fn decode_raw(data: Buffer) -> Result<Buffer> {
    match decode(1, data.len() as u32, &data)? {
        SonicValue::Bytes(v) => Ok(v.into()),
        _ => Err(NapiError::from_reason("RAW did not decode bytes")),
    }
}
#[napi]
pub fn encode_hex(value: String) -> Result<Buffer> {
    encode(17, 1, SonicValue::String(value))
}
#[napi]
pub fn decode_hex(data: Buffer) -> Result<String> {
    match decode(17, 1, &data)? {
        SonicValue::String(v) => Ok(v),
        _ => Err(NapiError::from_reason("HEX did not decode a string")),
    }
}

fn buffers(values: Vec<Buffer>) -> Vec<Vec<u8>> {
    values.into_iter().map(|v| v.to_vec()).collect()
}
#[napi]
pub fn frame_object(sectors: Vec<Buffer>) -> Result<Buffer> {
    batching::encode_batches(&buffers(sectors))
        .map(Buffer::from)
        .map_err(napi_error)
}
#[napi]
pub fn unframe_object(data: Buffer, field_count: u32) -> Result<Vec<Buffer>> {
    batching::decode_batches_limited(&data, field_count as usize)
        .and_then(|v| {
            if v.len() == field_count as usize {
                Ok(v)
            } else {
                Err(crate::Error::InvalidData("object field count mismatch"))
            }
        })
        .map(|v| v.into_iter().map(Buffer::from).collect())
        .map_err(napi_error)
}
#[napi]
pub fn encode_batch(payloads: Vec<Buffer>, compress: bool) -> Result<Buffer> {
    let data = batching::encode_batches(&buffers(payloads)).map_err(napi_error)?;
    if compress {
        gzip::compress(&data).map(Buffer::from).map_err(napi_error)
    } else {
        Ok(data.into())
    }
}
#[napi]
pub fn decode_batch(data: Buffer, compressed: bool, max_batch_size: u32) -> Result<Vec<Buffer>> {
    let data = if compressed {
        gzip::decompress(&data).map_err(napi_error)?
    } else {
        data.to_vec()
    };
    batching::decode_batches_limited(&data, max_batch_size as usize)
        .map(|v| v.into_iter().map(Buffer::from).collect())
        .map_err(napi_error)
}
#[napi]
pub fn deflate_raw(data: Buffer) -> Result<Buffer> {
    gzip::compress(&data).map(Buffer::from).map_err(napi_error)
}
#[napi]
pub fn inflate_raw(data: Buffer) -> Result<Buffer> {
    gzip::decompress(&data)
        .map(Buffer::from)
        .map_err(napi_error)
}

#[napi]
pub fn validate_encoded(
    kind: u8,
    data: Buffer,
    min: u32,
    max: u32,
    compressed: bool,
    batched: bool,
    max_batch_size: Option<u32>,
) -> Result<()> {
    let mut definition = packet(kind, max)?;
    definition.schema.data_min = SchemaLimit::Single(u64::from(min));
    definition.schema.gzip_compression = compressed;
    definition.schema.data_batching = if batched { 1 } else { 0 };
    definition.schema.max_batch_size = max_batch_size.unwrap_or(0) as i32;
    if batched {
        validate_batched(&definition, &data)
    } else {
        validate_packet(&definition, &data)
    }
    .map_err(napi_error)
}

#[napi]
pub fn validate_enum(data: Buffer, enum_size: u32, min: u32, max: u32) -> Result<()> {
    let mut definition = packet(PacketType::Enums as u8, max)?;
    definition.schema.data_min = SchemaLimit::Single(u64::from(min));
    definition.enum_data.push(crate::enums::EnumPackage {
        name: "ffi".into(),
        values: (0..enum_size)
            .map(|index| crate::enums::EnumValue::String(index.to_string()))
            .collect(),
    });
    validate_packet(&definition, &data).map_err(napi_error)
}

#[napi]
pub fn validate_object(
    data: Buffer,
    kinds: Vec<u8>,
    minimums: Vec<u32>,
    maximums: Vec<u32>,
    enum_sizes: Vec<u32>,
) -> Result<()> {
    let types = kinds
        .into_iter()
        .map(packet_type)
        .collect::<Result<Vec<_>>>()?;
    let enum_data = enum_sizes
        .into_iter()
        .enumerate()
        .map(|(package, size)| crate::enums::EnumPackage {
            name: format!("ffi-{package}"),
            values: (0..size)
                .map(|index| crate::enums::EnumValue::String(index.to_string()))
                .collect(),
        })
        .collect();
    let definition = PacketDef {
        tag: "ffi-object".into(),
        schema: PacketSchema {
            object: true,
            packet_type: SchemaType::Object(types),
            data_min: SchemaLimit::Object(minimums.into_iter().map(u64::from).collect()),
            data_max: SchemaLimit::Object(maximums.into_iter().map(u64::from).collect()),
            data_batching: 0,
            max_batch_size: 0,
            dont_spread: false,
            auto_flatten: false,
            rereference: false,
            gzip_compression: false,
        },
        enum_data,
    };
    validate_packet(&definition, &data).map_err(napi_error)
}
