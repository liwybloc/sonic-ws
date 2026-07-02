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

use crate::{Error, Result};
use crate::{
    primitives::{huffman, varint},
    wire::Reader,
};

pub fn encode_ascii(values: &[String]) -> Result<Vec<u8>> {
    let mut out = varint::encode(values.len() as u64);
    for value in values {
        out.extend(varint::encode(value.chars().count() as u64));
    }
    let joined: String = values.iter().map(String::as_str).collect();
    out.extend(huffman::encode_huffman(&joined).ok_or(Error::InvalidData(
        "character is absent from the TypeScript Huffman table",
    ))?);
    Ok(out)
}

pub fn decode_ascii(bytes: &[u8]) -> Result<Vec<String>> {
    let mut reader = Reader::new(bytes);
    let count = varint::decode(&mut reader)? as usize;
    let mut lengths = Vec::with_capacity(count);
    for _ in 0..count {
        lengths.push(varint::decode(&mut reader)? as usize);
    }
    let expected = lengths.iter().sum();
    let decoded = huffman::decode_huffman_exact(reader.read_exact(reader.remaining())?, expected)
        .ok_or(Error::InvalidData(
        "invalid or incorrectly padded Huffman payload",
    ))?;
    let chars: Vec<char> = decoded.chars().collect();
    let mut offset = 0;
    let mut out = Vec::with_capacity(count);
    for len in lengths {
        if offset + len > chars.len() {
            return Err(Error::InvalidData("truncated Huffman string"));
        }
        out.push(chars[offset..offset + len].iter().collect());
        offset += len;
    }
    Ok(out)
}

pub fn encode_codepoints(values: &[String]) -> Vec<u8> {
    let mut out = vec![];
    for value in values {
        let chars: Vec<char> = value.chars().collect();
        out.extend(varint::encode(chars.len() as u64));
        for ch in chars {
            out.extend(varint::encode(ch as u32 as u64));
        }
    }
    out
}
pub fn decode_codepoints(bytes: &[u8]) -> Result<Vec<String>> {
    let mut r = Reader::new(bytes);
    let mut out = vec![];
    while !r.is_empty() {
        let n = varint::decode(&mut r)? as usize;
        let mut s = String::new();
        for _ in 0..n {
            s.push(
                char::from_u32(varint::decode(&mut r)? as u32)
                    .ok_or(Error::InvalidData("invalid Unicode code point"))?,
            )
        }
        out.push(s)
    }
    Ok(out)
}

pub fn encode_utf8(value: &str) -> Vec<u8> {
    value.as_bytes().to_vec()
}
pub fn decode_utf8(bytes: &[u8]) -> Result<String> {
    String::from_utf8(bytes.to_vec()).map_err(|_| Error::InvalidData("invalid UTF-8 string"))
}
pub fn encode_utf16(value: &str) -> Vec<u16> {
    value.encode_utf16().collect()
}
pub fn decode_utf16(values: &[u16]) -> Result<String> {
    String::from_utf16(values).map_err(|_| Error::InvalidData("invalid UTF-16 string"))
}
