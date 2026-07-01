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

use js_sys::{Array, Uint8Array};
use wasm_bindgen::prelude::*;

use crate::{
    PacketDef, PacketSchema, PacketType, SchemaLimit, SchemaType, SonicValue, batching,
    codec::{
        decode::decode_packet,
        encode::encode_packet,
        validate::{validate_batched, validate_packet},
    },
    compression::gzip,
};

fn error(error: crate::Error) -> JsValue {
    JsValue::from_str(&error.to_string())
}

fn kind(value: u8) -> Result<PacketType, JsValue> {
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
        _ => return Err(JsValue::from_str("unknown packet type")),
    })
}

fn packet(value: u8, cap: u32) -> Result<PacketDef, JsValue> {
    Ok(PacketDef {
        tag: "wasm".into(),
        schema: PacketSchema {
            object: false,
            packet_type: SchemaType::Single(kind(value)?),
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

fn bytes(value: &JsValue) -> Vec<u8> {
    Uint8Array::new(value).to_vec()
}

fn byte_arrays(values: Array) -> Vec<Vec<u8>> {
    values.iter().map(|value| bytes(&value)).collect()
}

fn array_buffers(values: Vec<Vec<u8>>) -> Array {
    values
        .into_iter()
        .map(|value| Uint8Array::from(value.as_slice()))
        .collect()
}

fn numbers_i32(values: Array) -> Result<Vec<i32>, JsValue> {
    values
        .iter()
        .map(|v| {
            v.as_f64()
                .map(|n| n as i32)
                .ok_or_else(|| JsValue::from_str("expected number"))
        })
        .collect()
}

fn numbers_u32(values: Array) -> Result<Vec<u32>, JsValue> {
    values
        .iter()
        .map(|v| {
            v.as_f64()
                .and_then(|n| u32::try_from(n as i64).ok())
                .ok_or_else(|| JsValue::from_str("expected unsigned integer"))
        })
        .collect()
}

fn numbers_f64(values: Array) -> Result<Vec<f64>, JsValue> {
    values
        .iter()
        .map(|v| {
            v.as_f64()
                .ok_or_else(|| JsValue::from_str("expected number"))
        })
        .collect()
}

fn strings(values: Array) -> Result<Vec<String>, JsValue> {
    values
        .iter()
        .map(|v| {
            v.as_string()
                .ok_or_else(|| JsValue::from_str("expected string"))
        })
        .collect()
}

fn booleans(values: Array) -> Result<Vec<bool>, JsValue> {
    values
        .iter()
        .map(|v| {
            v.as_bool()
                .ok_or_else(|| JsValue::from_str("expected boolean"))
        })
        .collect()
}

fn encode(value: u8, sonic: SonicValue) -> Result<Uint8Array, JsValue> {
    let cap = match &sonic {
        SonicValue::Array(v) => v.len(),
        _ => 1,
    };

    encode_packet(&packet(value, cap as u32)?, &sonic)
        .map(|v| Uint8Array::from(v.as_slice()))
        .map_err(error)
}

fn decode(value: u8, cap: u32, data: &[u8]) -> Result<SonicValue, JsValue> {
    decode_packet(&packet(value, cap)?, data).map_err(error)
}

#[wasm_bindgen(js_name = encodeSigned)]
pub fn encode_signed(value: u8, values: Array) -> Result<Uint8Array, JsValue> {
    encode(
        value,
        SonicValue::Array(
            numbers_i32(values)?
                .into_iter()
                .map(|v| SonicValue::I64(i64::from(v)))
                .collect(),
        ),
    )
}

#[wasm_bindgen(js_name = decodeSigned)]
pub fn decode_signed(value: u8, data: Uint8Array) -> Result<Array, JsValue> {
    match decode(value, u32::MAX, &data.to_vec())? {
        SonicValue::Array(v) => v
            .into_iter()
            .map(|v| {
                if let SonicValue::I64(n) = v {
                    Ok(JsValue::from_f64(n as f64))
                } else {
                    Err(JsValue::from_str("expected signed result"))
                }
            })
            .collect(),
        _ => Err(JsValue::from_str("expected array")),
    }
}

#[wasm_bindgen(js_name = encodeUnsigned)]
pub fn encode_unsigned(value: u8, values: Array) -> Result<Uint8Array, JsValue> {
    encode(
        value,
        SonicValue::Array(
            numbers_u32(values)?
                .into_iter()
                .map(|v| SonicValue::U64(u64::from(v)))
                .collect(),
        ),
    )
}

#[wasm_bindgen(js_name = decodeUnsigned)]
pub fn decode_unsigned(value: u8, data: Uint8Array) -> Result<Array, JsValue> {
    match decode(value, u32::MAX, &data.to_vec())? {
        SonicValue::Array(v) => v
            .into_iter()
            .map(|v| {
                if let SonicValue::U64(n) = v {
                    Ok(JsValue::from_f64(n as f64))
                } else {
                    Err(JsValue::from_str("expected unsigned result"))
                }
            })
            .collect(),
        _ => Err(JsValue::from_str("expected array")),
    }
}

#[wasm_bindgen(js_name = encodeFloats)]
pub fn encode_floats(value: u8, values: Array) -> Result<Uint8Array, JsValue> {
    let values = numbers_f64(values)?
        .into_iter()
        .map(|v| {
            if value == 12 {
                SonicValue::F32(v as f32)
            } else {
                SonicValue::F64(v)
            }
        })
        .collect();

    encode(value, SonicValue::Array(values))
}

#[wasm_bindgen(js_name = decodeFloats)]
pub fn decode_floats(value: u8, data: Uint8Array) -> Result<Array, JsValue> {
    match decode(value, u32::MAX, &data.to_vec())? {
        SonicValue::Array(v) => v
            .into_iter()
            .map(|v| match v {
                SonicValue::F32(n) => Ok(JsValue::from_f64(f64::from(n))),
                SonicValue::F64(n) => Ok(JsValue::from_f64(n)),
                _ => Err(JsValue::from_str("expected float result")),
            })
            .collect(),
        _ => Err(JsValue::from_str("expected array")),
    }
}

#[wasm_bindgen(js_name = encodeStrings)]
pub fn encode_strings(value: u8, values: Array) -> Result<Uint8Array, JsValue> {
    encode(
        value,
        SonicValue::Array(
            strings(values)?
                .into_iter()
                .map(SonicValue::String)
                .collect(),
        ),
    )
}

#[wasm_bindgen(js_name = decodeStrings)]
pub fn decode_strings(value: u8, data: Uint8Array) -> Result<Array, JsValue> {
    match decode(value, u32::MAX, &data.to_vec())? {
        SonicValue::Array(v) => v
            .into_iter()
            .map(|v| {
                if let SonicValue::String(s) = v {
                    Ok(JsValue::from_str(&s))
                } else {
                    Err(JsValue::from_str("expected string result"))
                }
            })
            .collect(),
        _ => Err(JsValue::from_str("expected array")),
    }
}

#[wasm_bindgen(js_name = encodeBooleans)]
pub fn encode_booleans(values: Array) -> Result<Uint8Array, JsValue> {
    encode(
        14,
        SonicValue::Array(
            booleans(values)?
                .into_iter()
                .map(SonicValue::Bool)
                .collect(),
        ),
    )
}

#[wasm_bindgen(js_name = decodeBooleans)]
pub fn decode_booleans(data: Uint8Array, count: u32) -> Result<Array, JsValue> {
    match decode(14, count, &data.to_vec())? {
        SonicValue::Array(v) => v
            .into_iter()
            .map(|v| {
                if let SonicValue::Bool(b) = v {
                    Ok(JsValue::from_bool(b))
                } else {
                    Err(JsValue::from_str("expected boolean result"))
                }
            })
            .collect(),
        _ => Err(JsValue::from_str("expected array")),
    }
}

#[wasm_bindgen(js_name = encodeRaw)]
pub fn encode_raw(data: Uint8Array) -> Result<Uint8Array, JsValue> {
    encode(1, SonicValue::Bytes(data.to_vec()))
}

#[wasm_bindgen(js_name = decodeRaw)]
pub fn decode_raw(data: Uint8Array) -> Result<Uint8Array, JsValue> {
    match decode(1, data.length(), &data.to_vec())? {
        SonicValue::Bytes(v) => Ok(Uint8Array::from(v.as_slice())),
        _ => Err(JsValue::from_str("expected raw result")),
    }
}

#[wasm_bindgen(js_name = encodeHex)]
pub fn encode_hex(value: String) -> Result<Uint8Array, JsValue> {
    encode(17, SonicValue::String(value))
}

#[wasm_bindgen(js_name = decodeHex)]
pub fn decode_hex(data: Uint8Array) -> Result<String, JsValue> {
    match decode(17, 1, &data.to_vec())? {
        SonicValue::String(v) => Ok(v),
        _ => Err(JsValue::from_str("expected hex result")),
    }
}

#[wasm_bindgen(js_name = frameObject)]
pub fn frame_object(sectors: Array) -> Result<Uint8Array, JsValue> {
    batching::encode_batches(&byte_arrays(sectors))
        .map(|v| Uint8Array::from(v.as_slice()))
        .map_err(error)
}

#[wasm_bindgen(js_name = unframeObject)]
pub fn unframe_object(data: Uint8Array, count: u32) -> Result<Array, JsValue> {
    let values = batching::decode_batches_limited(&data.to_vec(), count as usize).map_err(error)?;

    if values.len() != count as usize {
        return Err(JsValue::from_str("object field count mismatch"));
    }

    Ok(array_buffers(values))
}

#[wasm_bindgen(js_name = encodeBatch)]
pub fn encode_batch(values: Array, compressed: bool) -> Result<Uint8Array, JsValue> {
    let data = batching::encode_batches(&byte_arrays(values)).map_err(error)?;
    let data = if compressed {
        gzip::compress(&data).map_err(error)?
    } else {
        data
    };

    Ok(Uint8Array::from(data.as_slice()))
}

#[wasm_bindgen(js_name = decodeBatch)]
pub fn decode_batch(data: Uint8Array, compressed: bool, max: u32) -> Result<Array, JsValue> {
    let data = if compressed {
        gzip::decompress(&data.to_vec()).map_err(error)?
    } else {
        data.to_vec()
    };

    batching::decode_batches_limited(&data, max as usize)
        .map(array_buffers)
        .map_err(error)
}

#[wasm_bindgen(js_name = deflateRaw)]
pub fn deflate_raw(data: Uint8Array) -> Result<Uint8Array, JsValue> {
    gzip::compress(&data.to_vec())
        .map(|v| Uint8Array::from(v.as_slice()))
        .map_err(error)
}

#[wasm_bindgen(js_name = inflateRaw)]
pub fn inflate_raw(data: Uint8Array) -> Result<Uint8Array, JsValue> {
    gzip::decompress(&data.to_vec())
        .map(|v| Uint8Array::from(v.as_slice()))
        .map_err(error)
}

#[wasm_bindgen(js_name = validateEncoded)]
pub fn validate_encoded(
    value: u8,
    data: Uint8Array,
    min: u32,
    max: u32,
    compressed: bool,
    batched: bool,
    max_batch: Option<u32>,
) -> Result<(), JsValue> {
    let mut p = packet(value, max)?;

    p.schema.data_min = SchemaLimit::Single(u64::from(min));
    p.schema.gzip_compression = compressed;
    p.schema.data_batching = if batched { 1 } else { 0 };
    p.schema.max_batch_size = max_batch.unwrap_or(0) as i32;

    (if batched {
        validate_batched(&p, &data.to_vec())
    } else {
        validate_packet(&p, &data.to_vec())
    })
    .map_err(error)
}

#[wasm_bindgen(js_name = validateEnum)]
pub fn validate_enum(data: Uint8Array, size: u32, min: u32, max: u32) -> Result<(), JsValue> {
    let mut p = packet(4, max)?;

    p.schema.data_min = SchemaLimit::Single(u64::from(min));
    p.enum_data.push(crate::enums::EnumPackage {
        name: "wasm".into(),
        values: (0..size)
            .map(|v| crate::enums::EnumValue::String(v.to_string()))
            .collect(),
    });

    validate_packet(&p, &data.to_vec()).map_err(error)
}

#[wasm_bindgen(js_name = validateObject)]
pub fn validate_object(
    data: Uint8Array,
    kinds: Array,
    mins: Array,
    maxes: Array,
    enum_sizes: Array,
) -> Result<(), JsValue> {
    let types = numbers_u32(kinds)?
        .into_iter()
        .map(|v| kind(v as u8))
        .collect::<Result<Vec<_>, _>>()?;
    let mins = numbers_u32(mins)?.into_iter().map(u64::from).collect();
    let maxes = numbers_u32(maxes)?.into_iter().map(u64::from).collect();
    let enums = numbers_u32(enum_sizes)?
        .into_iter()
        .enumerate()
        .map(|(i, size)| crate::enums::EnumPackage {
            name: format!("wasm -{i}"),
            values: (0..size)
                .map(|v| crate::enums::EnumValue::String(v.to_string()))
                .collect(),
        })
        .collect();

    let p = PacketDef {
        tag: "wasm - object".into(),
        schema: PacketSchema {
            object: true,
            packet_type: SchemaType::Object(types),
            data_min: SchemaLimit::Object(mins),
            data_max: SchemaLimit::Object(maxes),
            data_batching: 0,
            max_batch_size: 0,
            dont_spread: false,
            auto_flatten: false,
            rereference: false,
            gzip_compression: false,
        },
        enum_data: enums,
    };

    validate_packet(&p, &data.to_vec()).map_err(error)
}
