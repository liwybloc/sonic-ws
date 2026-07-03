/* Stable dependency-free ABI consumed by projects/py/src/sonic_ws/_core.py. */
use crate::{
    PacketDef, PacketSchema, PacketType, SchemaLimit, SchemaType, SonicValue, batching,
    codec::{decode::decode_packet, encode::encode_packet, validate::validate_packet},
    compression::gzip,
};
use std::{ptr, slice};

#[repr(C)]
pub struct PythonBuffer {
    pub data: *mut u8,
    pub len: usize,
    pub capacity: usize,
    pub ok: bool,
}
impl PythonBuffer {
    fn ok(mut value: Vec<u8>) -> Self {
        let result = Self {
            data: value.as_mut_ptr(),
            len: value.len(),
            capacity: value.capacity(),
            ok: true,
        };
        std::mem::forget(value);
        result
    }
    fn error() -> Self {
        Self {
            data: ptr::null_mut(),
            len: 0,
            capacity: 0,
            ok: false,
        }
    }
}
#[unsafe(no_mangle)]
pub extern "C" fn sonic_ws_python_free(data: *mut u8, len: usize, capacity: usize) {
    if !data.is_null() {
        unsafe {
            drop(Vec::from_raw_parts(data, len, capacity));
        }
    }
}
fn kind(value: u8) -> Option<PacketType> {
    Some(match value {
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
        16 => PacketType::Reserved16,
        17 => PacketType::Hex,
        _ => return None,
    })
}
fn packet(value: u8, cap: u64) -> Option<PacketDef> {
    Some(PacketDef {
        tag: "python".into(),
        schema: PacketSchema {
            object: false,
            packet_type: SchemaType::Single(kind(value)?),
            data_min: SchemaLimit::Single(0),
            data_max: SchemaLimit::Single(cap),
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
fn input<'a>(data: *const u8, len: usize) -> Option<&'a [u8]> {
    if data.is_null() && len > 0 {
        None
    } else {
        Some(unsafe { slice::from_raw_parts(data, len) })
    }
}
fn numbers_i64(data: &[u8]) -> Option<Vec<SonicValue>> {
    if !data.len().is_multiple_of(8) {
        return None;
    }
    Some(
        data.chunks_exact(8)
            .map(|v| SonicValue::I64(i64::from_le_bytes(v.try_into().unwrap())))
            .collect(),
    )
}
fn numbers_u64(data: &[u8]) -> Option<Vec<SonicValue>> {
    if !data.len().is_multiple_of(8) {
        return None;
    }
    Some(
        data.chunks_exact(8)
            .map(|v| SonicValue::U64(u64::from_le_bytes(v.try_into().unwrap())))
            .collect(),
    )
}
fn numbers_f64(data: &[u8], single: bool) -> Option<Vec<SonicValue>> {
    if !data.len().is_multiple_of(8) {
        return None;
    }
    Some(
        data.chunks_exact(8)
            .map(|v| {
                let n = f64::from_le_bytes(v.try_into().unwrap());
                if single {
                    SonicValue::F32(n as f32)
                } else {
                    SonicValue::F64(n)
                }
            })
            .collect(),
    )
}
fn flatten_decoded(value: SonicValue) -> Option<Vec<u8>> {
    let SonicValue::Array(values) = value else {
        return None;
    };
    let mut out = vec![];
    for value in values {
        match value {
            SonicValue::I64(n) => out.extend(n.to_le_bytes()),
            SonicValue::U64(n) => out.extend(n.to_le_bytes()),
            SonicValue::F32(n) => out.extend(f64::from(n).to_le_bytes()),
            SonicValue::F64(n) => out.extend(n.to_le_bytes()),
            SonicValue::Bool(n) => out.push(n as u8),
            SonicValue::String(n) => out.extend(batching::encode_batches(&[n.into_bytes()]).ok()?),
            _ => return None,
        }
    }
    Some(out)
}

/// Operation IDs are private to the Python loader. Inputs containing lists use
/// little-endian fixed-width values or SonicWS batch framing for strings.
#[unsafe(no_mangle)]
pub extern "C" fn sonic_ws_python_call(
    operation: u8,
    value: u8,
    data: *const u8,
    len: usize,
    arg: u64,
) -> PythonBuffer {
    let Some(data) = input(data, len) else {
        return PythonBuffer::error();
    };
    let result = (|| -> Option<Vec<u8>> {
        match operation {
            1 => encode_packet(
                &packet(value, u32::MAX.into())?,
                &SonicValue::Array(numbers_i64(data)?),
            )
            .ok(),
            2 => flatten_decoded(decode_packet(&packet(value, arg)?, data).ok()?),
            3 => encode_packet(
                &packet(value, u32::MAX.into())?,
                &SonicValue::Array(numbers_u64(data)?),
            )
            .ok(),
            4 => flatten_decoded(decode_packet(&packet(value, arg)?, data).ok()?),
            5 => encode_packet(
                &packet(value, u32::MAX.into())?,
                &SonicValue::Array(numbers_f64(data, value == 12)?),
            )
            .ok(),
            6 => flatten_decoded(decode_packet(&packet(value, arg)?, data).ok()?),
            7 => {
                let strings = batching::decode_batches(data)
                    .ok()?
                    .into_iter()
                    .map(|v| String::from_utf8(v).ok().map(SonicValue::String))
                    .collect::<Option<Vec<_>>>()?;
                encode_packet(
                    &packet(value, u32::MAX.into())?,
                    &SonicValue::Array(strings),
                )
                .ok()
            }
            8 => {
                let SonicValue::Array(values) = decode_packet(&packet(value, arg)?, data).ok()?
                else {
                    return None;
                };
                batching::encode_batches(
                    &values
                        .into_iter()
                        .map(|v| {
                            if let SonicValue::String(s) = v {
                                Some(s.into_bytes())
                            } else {
                                None
                            }
                        })
                        .collect::<Option<Vec<_>>>()?,
                )
                .ok()
            }
            9 => encode_packet(
                &packet(14, data.len() as u64)?,
                &SonicValue::Array(data.iter().map(|v| SonicValue::Bool(*v != 0)).collect()),
            )
            .ok(),
            10 => flatten_decoded(decode_packet(&packet(14, arg)?, data).ok()?),
            11 => Some(data.to_vec()),
            12 => encode_packet(
                &packet(17, 1)?,
                &SonicValue::String(String::from_utf8(data.to_vec()).ok()?),
            )
            .ok(),
            13 => {
                if let SonicValue::String(s) = decode_packet(&packet(17, 1)?, data).ok()? {
                    Some(s.into_bytes())
                } else {
                    None
                }
            }
            14 => {
                let values = batching::decode_batches(data).ok()?;
                batching::encode_batches(&values).ok()
            }
            15 => {
                let values = batching::decode_batches(data).ok()?;
                batching::encode_batches(&values).ok()
            }
            16 => {
                if value != 0 {
                    gzip::compress(data).ok()
                } else {
                    Some(data.to_vec())
                }
            }
            17 => {
                let decoded = if value != 0 {
                    gzip::decompress_limited(data, gzip::MAX_DECOMPRESSED_SIZE).ok()?
                } else {
                    data.to_vec()
                };
                let values = batching::decode_batches_limited(&decoded, arg as usize).ok()?;
                batching::encode_batches(&values).ok()
            }
            18 => gzip::compress(data).ok(),
            19 => {
                gzip::decompress_limited(data, (arg as usize).min(gzip::MAX_DECOMPRESSED_SIZE)).ok()
            }
            _ => None,
        }
    })();
    result.map_or_else(PythonBuffer::error, PythonBuffer::ok)
}

#[unsafe(no_mangle)]
pub extern "C" fn sonic_ws_python_validate(
    value: u8,
    data: *const u8,
    len: usize,
    minimum: u64,
    maximum: u64,
    compressed: bool,
) -> bool {
    let Some(data) = input(data, len) else {
        return false;
    };
    let Some(mut packet) = packet(value, maximum) else {
        return false;
    };
    packet.schema.data_min = SchemaLimit::Single(minimum);
    packet.schema.gzip_compression = compressed;
    validate_packet(&packet, data).is_ok()
}

// The Python WASM loader uses a deliberately small linear-memory ABI. Returning
// PythonBuffer directly would rely on target-specific aggregate-return rules.
#[cfg(target_arch = "wasm32")]
#[unsafe(no_mangle)]
pub extern "C" fn sonic_ws_python_wasm_alloc(len: u32) -> u32 {
    let mut value = vec![0u8; len as usize].into_boxed_slice();
    let pointer = value.as_mut_ptr() as u32;
    std::mem::forget(value);
    pointer
}

#[cfg(target_arch = "wasm32")]
#[unsafe(no_mangle)]
pub extern "C" fn sonic_ws_python_wasm_free(pointer: u32, len: u32) {
    if pointer != 0 {
        unsafe { drop(Box::from_raw(std::ptr::slice_from_raw_parts_mut(pointer as *mut u8, len as usize))) };
    }
}

/// Returns `(length << 32) | pointer`, or u64::MAX on failure.
#[cfg(target_arch = "wasm32")]
#[unsafe(no_mangle)]
pub extern "C" fn sonic_ws_python_wasm_call(
    operation: u8,
    value: u8,
    data: u32,
    len: u32,
    arg: u64,
) -> u64 {
    let result = sonic_ws_python_call(operation, value, data as *const u8, len as usize, arg);
    if !result.ok || result.len > u32::MAX as usize {
        return u64::MAX;
    }
    let owned = unsafe { Vec::from_raw_parts(result.data, result.len, result.capacity) }.into_boxed_slice();
    let length = owned.len() as u32;
    let pointer = if length == 0 { 0 } else { owned.as_ptr() as u32 };
    std::mem::forget(owned);
    (u64::from(length) << 32) | u64::from(pointer)
}
