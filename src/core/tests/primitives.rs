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

use sonic_ws_core::{
    compression::gzip,
    primitives::{bools, bytes, floats, hex, ints, strings, zigzag},
};

#[test]
fn bytes_are_identity_encoded() {
    let data = [0, 1, 127, 255];
    assert_eq!(bytes::decode(&bytes::encode(&data)), data);
}

#[test]
fn booleans_use_typescript_bit_order() {
    assert_eq!(
        bools::encode(&[true, false, true, false, false, false, false, true]),
        [0b1010_0001]
    );
}

#[test]
fn shorts_are_big_endian() {
    assert_eq!(ints::encode_u16(0x1234), [0x12, 0x34]);
    assert_eq!(ints::decode_u16(&[0x12, 0x34]).unwrap(), 0x1234);
    assert_eq!(ints::decode_i16(&ints::encode_i16(-123)).unwrap(), -123);
}

#[test]
fn floats_match_typescript_big_endian_format() {
    assert_eq!(floats::encode_f32(1.5), [0x3f, 0xc0, 0, 0]);
    assert_eq!(floats::decode_f64(floats::encode_f64(-12.25)), -12.25);
}

#[test]
fn zigzag_matches_javascript_i32_semantics() {
    for value in [i32::MIN as i64, -100, -1, 0, 1, 100, i32::MAX as i64] {
        assert_eq!(zigzag::decode(zigzag::encode(value)), value);
    }
    assert_eq!(
        zigzag::encode((i32::MAX as i64) + 1),
        zigzag::encode(i32::MIN as i64)
    );
}

#[test]
fn hex_roundtrips() {
    let data = [0, 0xab, 0xff];
    assert_eq!(hex::encode(&data), "00abff");
    assert_eq!(hex::decode("00abff").unwrap(), data);
}

#[test]
fn codepoint_strings_roundtrip() {
    let values = vec!["Sonic 🚀".to_owned(), "\u{10000}".to_owned()];
    assert_eq!(
        strings::decode_codepoints(&strings::encode_codepoints(&values)).unwrap(),
        values
    );
}

#[test]
fn raw_deflate_roundtrips() {
    let data = b"sonic websocket compression sonic websocket compression";
    assert_eq!(
        gzip::decompress(&gzip::compress(data).unwrap()).unwrap(),
        data
    );
}
