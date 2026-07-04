use serde_json::Value;

use crate::{Error, Result, json};

pub const KEY: u8 = 0;
pub const REQUEST: u8 = 1;
pub const RESPONSE: u8 = 2;
pub const REPLAY: u8 = 3;
pub const RESUME: u8 = 4;
pub const RESUMED: u8 = 5;

#[derive(Debug, Clone, PartialEq)]
pub enum Control {
    Request {
        id: u64,
        packet_key: u8,
        payload: Vec<u8>,
    },
    Response {
        id: u64,
        ok: bool,
        value: Value,
    },
    Replay {
        sequence: u64,
        payload: Vec<u8>,
    },
    Resume {
        session_id: String,
        last_sequence: u64,
    },
    Resumed {
        recovered: bool,
        replayed: u64,
    },
}

pub fn encode(control: &Control) -> Result<Vec<u8>> {
    let mut output = vec![KEY];
    match control {
        Control::Request {
            id,
            packet_key,
            payload,
        } => {
            output.push(REQUEST);
            varint(*id, &mut output);
            output.push(*packet_key);
            output.extend(payload);
        }
        Control::Response { id, ok, value } => {
            output.push(RESPONSE);
            varint(*id, &mut output);
            output.push(u8::from(*ok));
            output.extend(json::encode(value)?);
        }
        Control::Replay { sequence, payload } => {
            output.push(REPLAY);
            varint(*sequence, &mut output);
            output.extend(payload);
        }
        Control::Resume {
            session_id,
            last_sequence,
        } => {
            output.push(RESUME);
            varint(session_id.len() as u64, &mut output);
            output.extend(session_id.as_bytes());
            varint(*last_sequence, &mut output);
        }
        Control::Resumed {
            recovered,
            replayed,
        } => {
            output.push(RESUMED);
            output.push(u8::from(*recovered));
            varint(*replayed, &mut output);
        }
    }
    Ok(output)
}

pub fn decode(bytes: &[u8]) -> Result<Control> {
    if bytes.first() != Some(&KEY) || bytes.len() < 3 {
        return Err(Error::Protocol("invalid control frame".into()));
    }
    let mut cursor = Cursor { bytes, offset: 2 };
    Ok(match bytes[1] {
        REQUEST => {
            let id = cursor.varint()?;
            let packet_key = cursor.byte()?;
            Control::Request {
                id,
                packet_key,
                payload: cursor.rest().to_vec(),
            }
        }
        RESPONSE => {
            let id = cursor.varint()?;
            let ok = cursor.byte()? != 0;
            Control::Response {
                id,
                ok,
                value: json::decode(cursor.rest())?,
            }
        }
        REPLAY => {
            let sequence = cursor.varint()?;
            Control::Replay {
                sequence,
                payload: cursor.rest().to_vec(),
            }
        }
        RESUME => {
            let length = cursor.varint_usize()?;
            let session_id = String::from_utf8(cursor.take(length)?.to_vec())
                .map_err(|_| Error::Protocol("recovery session id is not UTF-8".into()))?;
            let last_sequence = cursor.varint()?;
            Control::Resume {
                session_id,
                last_sequence,
            }
        }
        RESUMED => Control::Resumed {
            recovered: cursor.byte()? != 0,
            replayed: cursor.varint()?,
        },
        kind => {
            return Err(Error::Protocol(format!(
                "unknown control frame type {kind}"
            )));
        }
    })
}

fn varint(mut value: u64, output: &mut Vec<u8>) {
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
struct Cursor<'a> {
    bytes: &'a [u8],
    offset: usize,
}
impl<'a> Cursor<'a> {
    fn take(&mut self, length: usize) -> Result<&'a [u8]> {
        let end = self
            .offset
            .checked_add(length)
            .ok_or_else(|| Error::Protocol("control length overflow".into()))?;
        if end > self.bytes.len() {
            return Err(Error::Protocol("truncated control frame".into()));
        }
        let value = &self.bytes[self.offset..end];
        self.offset = end;
        Ok(value)
    }
    fn byte(&mut self) -> Result<u8> {
        Ok(self.take(1)?[0])
    }
    fn rest(&self) -> &'a [u8] {
        &self.bytes[self.offset..]
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
        Err(Error::Protocol(
            "control variable integer is too long".into(),
        ))
    }
    fn varint_usize(&mut self) -> Result<usize> {
        usize::try_from(self.varint()?)
            .map_err(|_| Error::Protocol("control length exceeds platform".into()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn response_roundtrip() {
        let value = Control::Response {
            id: 42,
            ok: true,
            value: json!({"ok": true}),
        };
        assert_eq!(decode(&encode(&value).unwrap()).unwrap(), value);
    }
}
