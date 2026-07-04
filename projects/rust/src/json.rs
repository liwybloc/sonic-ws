use serde_json::{Map, Number, Value};
use sonic_ws_core::SonicValue;

use crate::{Error, Result};

const NULL: u8 = 0;
const BOOL: u8 = 1;
const INT: u8 = 2;
const FLOAT: u8 = 3;
const STRING: u8 = 4;
const ARRAY: u8 = 5;
const OBJECT: u8 = 6;

pub(crate) fn encode(value: &Value) -> Result<Vec<u8>> {
    let mut booleans = Vec::new();
    let mut types = Vec::new();
    let mut payload = Vec::new();
    encode_value(value, &mut booleans, &mut types, &mut payload, 0)?;

    let bool_bytes = booleans
        .chunks(8)
        .map(|chunk| {
            chunk.iter().enumerate().fold(0_u8, |byte, (index, value)| {
                byte | (u8::from(*value) << (7 - index))
            })
        })
        .collect::<Vec<_>>();
    let type_bytes = pack_types(&types);
    let mut output = Vec::new();
    write_varint(bool_bytes.len() as u64, &mut output);
    write_varint(type_bytes.len() as u64, &mut output);
    output.extend(bool_bytes);
    output.extend(type_bytes);
    output.extend(payload);
    Ok(output)
}

pub(crate) fn decode(bytes: &[u8]) -> Result<Value> {
    let mut cursor = Cursor::new(bytes);
    let bool_length = cursor.varint_usize()?;
    let type_length = cursor.varint_usize()?;
    let bools = cursor
        .take(bool_length)?
        .iter()
        .flat_map(|byte| (0..8).map(move |index| byte & (1 << (7 - index)) != 0))
        .collect::<Vec<_>>();
    let types = unpack_types(cursor.take(type_length)?);
    let mut state = DecodeState {
        cursor,
        types: &types,
        type_index: 0,
        bools: &bools,
        bool_index: 0,
    };
    decode_value(&mut state, 0)
}

pub(crate) fn encode_sonic(value: &SonicValue) -> Result<Vec<u8>> {
    encode(&sonic_to_json(value)?)
}

pub(crate) fn decode_sonic(bytes: &[u8]) -> Result<SonicValue> {
    Ok(json_to_sonic(decode(bytes)?))
}

fn sonic_to_json(value: &SonicValue) -> Result<Value> {
    Ok(match value {
        SonicValue::Null | SonicValue::Undefined => Value::Null,
        SonicValue::Bool(value) => Value::Bool(*value),
        SonicValue::I64(value) => Value::Number((*value).into()),
        SonicValue::U64(value) => Value::Number((*value).into()),
        SonicValue::F32(value) => Number::from_f64(f64::from(*value))
            .map(Value::Number)
            .ok_or_else(|| Error::Value("JSON numbers must be finite".into()))?,
        SonicValue::F64(value) => Number::from_f64(*value)
            .map(Value::Number)
            .ok_or_else(|| Error::Value("JSON numbers must be finite".into()))?,
        SonicValue::String(value) => Value::String(value.clone()),
        SonicValue::Array(values) => Value::Array(
            values
                .iter()
                .map(sonic_to_json)
                .collect::<Result<Vec<_>>>()?,
        ),
        SonicValue::Object(entries) => Value::Object(
            entries
                .iter()
                .map(|(key, value)| Ok((key.clone(), sonic_to_json(value)?)))
                .collect::<Result<Map<_, _>>>()?,
        ),
        SonicValue::Bytes(_) => {
            return Err(Error::Value(
                "bytes are not supported by JSON packets".into(),
            ));
        }
    })
}

fn json_to_sonic(value: Value) -> SonicValue {
    match value {
        Value::Null => SonicValue::Null,
        Value::Bool(value) => SonicValue::Bool(value),
        Value::Number(value) => value
            .as_i64()
            .map(SonicValue::I64)
            .or_else(|| value.as_u64().map(SonicValue::U64))
            .unwrap_or_else(|| SonicValue::F64(value.as_f64().expect("JSON number"))),
        Value::String(value) => SonicValue::String(value),
        Value::Array(values) => SonicValue::Array(values.into_iter().map(json_to_sonic).collect()),
        Value::Object(values) => SonicValue::Object(
            values
                .into_iter()
                .map(|(key, value)| (key, json_to_sonic(value)))
                .collect(),
        ),
    }
}

fn encode_value(
    value: &Value,
    booleans: &mut Vec<bool>,
    types: &mut Vec<u8>,
    payload: &mut Vec<u8>,
    depth: usize,
) -> Result<()> {
    if depth > 500 {
        return Err(Error::Value("JSON nesting exceeds 500 levels".into()));
    }
    match value {
        Value::Null => types.push(NULL),
        Value::Bool(value) => {
            types.push(BOOL);
            booleans.push(*value);
        }
        Value::Number(number) if number.is_i64() || number.is_u64() => {
            let number = number
                .as_i64()
                .or_else(|| number.as_u64().and_then(|value| i64::try_from(value).ok()))
                .ok_or_else(|| Error::Value("JSON integer exceeds signed 64-bit range".into()))?;
            let integer = i32::try_from(number).map_err(|_| {
                Error::Value("SonicWS JSON integers use signed 32-bit values".into())
            })?;
            types.push(INT);
            write_varint(((integer << 1) ^ (integer >> 31)) as u32 as u64, payload);
        }
        Value::Number(number) => {
            let value = number
                .as_f64()
                .ok_or_else(|| Error::Value("invalid JSON number".into()))?
                as f32;
            types.push(FLOAT);
            payload.extend(value.to_bits().to_be_bytes());
        }
        Value::String(value) => {
            types.push(STRING);
            write_string(value, payload);
        }
        Value::Array(values) => {
            types.push(ARRAY);
            write_varint(values.len() as u64, payload);
            for value in values {
                encode_value(value, booleans, types, payload, depth + 1)?;
            }
        }
        Value::Object(values) => {
            types.push(OBJECT);
            write_varint(values.len() as u64, payload);
            for (key, value) in values {
                write_string(key, payload);
                encode_value(value, booleans, types, payload, depth + 1)?;
            }
        }
    }
    Ok(())
}

struct DecodeState<'a> {
    cursor: Cursor<'a>,
    types: &'a [u8],
    type_index: usize,
    bools: &'a [bool],
    bool_index: usize,
}
fn decode_value(state: &mut DecodeState<'_>, depth: usize) -> Result<Value> {
    if depth > 500 {
        return Err(Error::Protocol("JSON nesting exceeds 500 levels".into()));
    }
    let kind = *state
        .types
        .get(state.type_index)
        .ok_or_else(|| Error::Protocol("JSON type stream ended early".into()))?;
    state.type_index += 1;
    Ok(match kind {
        NULL => Value::Null,
        BOOL => {
            let value = *state
                .bools
                .get(state.bool_index)
                .ok_or_else(|| Error::Protocol("JSON boolean stream ended early".into()))?;
            state.bool_index += 1;
            Value::Bool(value)
        }
        INT => {
            let value = state.cursor.varint()? as u32;
            Value::Number(Number::from(((value >> 1) as i32) ^ -((value & 1) as i32)))
        }
        FLOAT => {
            let raw: [u8; 4] = state.cursor.take(4)?.try_into().expect("length checked");
            let value = f32::from_bits(u32::from_be_bytes(raw)) as f64;
            Number::from_f64(value)
                .map(Value::Number)
                .unwrap_or(Value::Null)
        }
        STRING => Value::String(state.cursor.string()?),
        ARRAY => {
            let count = state.cursor.varint_usize()?;
            Value::Array(
                (0..count)
                    .map(|_| decode_value(state, depth + 1))
                    .collect::<Result<Vec<_>>>()?,
            )
        }
        OBJECT => {
            let count = state.cursor.varint_usize()?;
            let mut object = Map::new();
            for _ in 0..count {
                let key = state.cursor.string()?;
                object.insert(key, decode_value(state, depth + 1)?);
            }
            Value::Object(object)
        }
        _ => return Err(Error::Protocol(format!("unknown JSON type {kind}"))),
    })
}

fn write_string(value: &str, output: &mut Vec<u8>) {
    write_varint(value.len() as u64, output);
    output.extend(value.as_bytes());
}
fn write_varint(mut value: u64, output: &mut Vec<u8>) {
    loop {
        let mut byte = (value & 0x7f) as u8;
        value >>= 7;
        if value != 0 {
            byte |= 0x80;
        }
        output.push(byte);
        if value == 0 {
            break;
        }
    }
}
fn pack_types(types: &[u8]) -> Vec<u8> {
    let mut output = vec![0; types.len().saturating_mul(3).div_ceil(8)];
    for (index, kind) in types.iter().enumerate() {
        for bit in 0..3 {
            if kind & (1 << (2 - bit)) != 0 {
                let position = index * 3 + bit;
                output[position / 8] |= 1 << (7 - position % 8);
            }
        }
    }
    output
}
fn unpack_types(bytes: &[u8]) -> Vec<u8> {
    (0..bytes.len() * 8 / 3)
        .map(|index| {
            (0..3).fold(0, |kind, bit| {
                let position = index * 3 + bit;
                kind | (((bytes[position / 8] >> (7 - position % 8)) & 1) << (2 - bit))
            })
        })
        .collect()
}

#[derive(Clone, Copy)]
struct Cursor<'a> {
    bytes: &'a [u8],
    offset: usize,
}
impl<'a> Cursor<'a> {
    fn new(bytes: &'a [u8]) -> Self {
        Self { bytes, offset: 0 }
    }
    fn take(&mut self, length: usize) -> Result<&'a [u8]> {
        let end = self
            .offset
            .checked_add(length)
            .ok_or_else(|| Error::Protocol("JSON length overflow".into()))?;
        if end > self.bytes.len() {
            return Err(Error::Protocol("truncated JSON payload".into()));
        }
        let result = &self.bytes[self.offset..end];
        self.offset = end;
        Ok(result)
    }
    fn byte(&mut self) -> Result<u8> {
        Ok(self.take(1)?[0])
    }
    fn varint(&mut self) -> Result<u64> {
        let mut value = 0;
        for shift in (0..=63).step_by(7) {
            let byte = self.byte()?;
            value |= u64::from(byte & 0x7f) << shift;
            if byte & 0x80 == 0 {
                return Ok(value);
            }
        }
        Err(Error::Protocol("JSON variable integer is too long".into()))
    }
    fn varint_usize(&mut self) -> Result<usize> {
        usize::try_from(self.varint()?)
            .map_err(|_| Error::Protocol("JSON length exceeds platform".into()))
    }
    fn string(&mut self) -> Result<String> {
        let length = self.varint_usize()?;
        String::from_utf8(self.take(length)?.to_vec())
            .map_err(|_| Error::Protocol("JSON string is not UTF-8".into()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn json_roundtrip() {
        let value = json!({"name": "sonic", "ok": true, "values": [null, -12, 1.5]});
        let encoded = encode(&value).unwrap();
        assert_eq!(decode(&encoded).unwrap(), value);
    }
}
