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
    PacketDef, PacketSchema, PacketType, SchemaLimit, SchemaType, SonicValue,
    batching::{decode_batches_limited, encode_batches, encode_for_packet},
    codec::{
        decode::decode_packet,
        encode::encode_packet,
        validate::{validate_batched, validate_packet},
    },
    enums::{EnumPackage, EnumValue},
    object::{decode::decode as decode_object, encode::encode as encode_object},
    primitives::{bools, hex, strings, varint},
    wire::Reader,
};

fn packet(kind: PacketType, min: u64, max: u64) -> PacketDef {
    PacketDef {
        tag: "test".into(),
        schema: PacketSchema {
            object: false,
            packet_type: SchemaType::Single(kind),
            data_min: SchemaLimit::Single(min),
            data_max: SchemaLimit::Single(max),
            data_batching: 0,
            max_batch_size: 0,
            dont_spread: false,
            auto_flatten: false,
            rereference: false,
            gzip_compression: false,
        },
        enum_data: vec![],
    }
}
fn array(v: Vec<SonicValue>) -> SonicValue {
    SonicValue::Array(v)
}
fn signed(v: &[i64]) -> SonicValue {
    array(v.iter().copied().map(SonicValue::I64).collect())
}
fn unsigned(v: &[u64]) -> SonicValue {
    array(v.iter().copied().map(SonicValue::U64).collect())
}
fn roundtrip(def: &PacketDef, value: &SonicValue) -> SonicValue {
    let data = encode_packet(def, value).unwrap();
    validate_packet(def, &data).unwrap();
    decode_packet(def, &data).unwrap()
}

#[test]
fn bools_pack_exact_8_bits() {
    assert_eq!(
        bools::encode(&[true, false, true, false, true, false, true, false]),
        [0xaa]
    );
}
#[test]
fn bools_pack_partial_byte_padding() {
    let v = [true, false, true];
    let data = bools::encode(&v);
    assert_eq!(data, [0xa0]);
    assert_eq!(bools::decode(&data, 3), v);
}
#[test]
fn bools_reject_non_bool() {
    assert!(
        encode_packet(
            &packet(PacketType::Booleans, 0, 2),
            &array(vec![SonicValue::Bool(true), SonicValue::I64(1)])
        )
        .is_err()
    );
}

#[test]
fn bytes_signed_boundaries() {
    let v = signed(&[-128, -1, 0, 1, 127]);
    assert_eq!(roundtrip(&packet(PacketType::Bytes, 5, 5), &v), v);
}
#[test]
fn bytes_signed_positive_overflow() {
    assert!(encode_packet(&packet(PacketType::Bytes, 0, 1), &signed(&[128])).is_err());
}
#[test]
fn bytes_signed_negative_overflow() {
    assert!(encode_packet(&packet(PacketType::Bytes, 0, 1), &signed(&[-129])).is_err());
}
#[test]
fn ubytes_boundaries() {
    let v = unsigned(&[0, 1, 254, 255]);
    assert_eq!(roundtrip(&packet(PacketType::UBytes, 4, 4), &v), v);
}
#[test]
fn ubytes_reject_negative() {
    assert!(encode_packet(&packet(PacketType::UBytes, 0, 1), &signed(&[-1])).is_err());
}
#[test]
fn ubytes_overflow() {
    assert!(encode_packet(&packet(PacketType::UBytes, 0, 1), &unsigned(&[256])).is_err());
}

#[test]
fn shorts_signed_boundaries() {
    let v = signed(&[-32768, -1, 0, 1, 32767]);
    assert_eq!(roundtrip(&packet(PacketType::Shorts, 5, 5), &v), v);
}
#[test]
fn shorts_signed_positive_overflow() {
    assert!(encode_packet(&packet(PacketType::Shorts, 0, 1), &signed(&[32768])).is_err());
}
#[test]
fn shorts_signed_negative_overflow() {
    assert!(encode_packet(&packet(PacketType::Shorts, 0, 1), &signed(&[-32769])).is_err());
}
#[test]
fn ushorts_boundaries() {
    let v = unsigned(&[0, 1, 65534, 65535]);
    assert_eq!(roundtrip(&packet(PacketType::UShorts, 4, 4), &v), v);
}
#[test]
fn ushorts_overflow() {
    assert!(encode_packet(&packet(PacketType::UShorts, 0, 1), &unsigned(&[65536])).is_err());
}

#[test]
fn varint_i32_boundaries() {
    let v = signed(&[i32::MIN as i64, -1, 0, 1, i32::MAX as i64]);
    assert_eq!(roundtrip(&packet(PacketType::VarInt, 5, 5), &v), v);
}
#[test]
fn varint_overflow_behavior() {
    let data = encode_packet(
        &packet(PacketType::VarInt, 1, 1),
        &signed(&[i32::MAX as i64 + 1]),
    )
    .unwrap();
    assert_eq!(
        decode_packet(&packet(PacketType::VarInt, 1, 1), &data).unwrap(),
        signed(&[i32::MIN as i64])
    );
}
#[test]
fn uvarint_large_values() {
    let v = unsigned(&[0, 1, 127, 128, 255, 16384, u32::MAX as u64]);
    assert_eq!(roundtrip(&packet(PacketType::UVarInt, 7, 7), &v), v);
}
#[test]
fn deltas_normal_sequence() {
    let v = signed(&[
        -50, -25, 1, 2, 3, 1000, 1004, 1006, 1007, 990, 900, 500, 600, 200, -5,
    ]);
    assert_eq!(roundtrip(&packet(PacketType::Deltas, 15, 15), &v), v);
}
#[test]
fn deltas_repeated_values() {
    let v = signed(&[5, 5, 5, 5, 5]);
    assert_eq!(roundtrip(&packet(PacketType::Deltas, 5, 5), &v), v);
}

#[test]
fn floats_special_values() {
    for kind in [PacketType::Floats, PacketType::Doubles] {
        let values = array(vec![
            SonicValue::F64(0.0),
            SonicValue::F64(-0.0),
            SonicValue::F64(f64::INFINITY),
            SonicValue::F64(f64::NEG_INFINITY),
            SonicValue::F64(f64::NAN),
            SonicValue::F64(1.5),
            SonicValue::F64(-1.5),
        ]);
        let data = encode_packet(&packet(kind, 7, 7), &values).unwrap();
        let SonicValue::Array(out) = decode_packet(&packet(kind, 7, 7), &data).unwrap() else {
            panic!()
        };
        let number = |v: &SonicValue| match v {
            SonicValue::F32(v) => f64::from(*v),
            SonicValue::F64(v) => *v,
            _ => panic!(),
        };
        assert!(!number(&out[0]).is_sign_negative());
        assert!(!number(&out[1]).is_sign_negative());
        if kind == PacketType::Floats {
            assert!(number(&out[2]).is_nan());
            assert!(number(&out[3]).is_nan())
        } else {
            assert_eq!(number(&out[2]), f64::INFINITY);
            assert_eq!(number(&out[3]), f64::NEG_INFINITY)
        }
        assert!(number(&out[4]).is_nan());
        assert_eq!(number(&out[5]), 1.5);
        assert_eq!(number(&out[6]), -1.5);
    }
}
#[test]
fn floats_precision_expected() {
    let n = 958412.128498;
    let f = roundtrip(
        &packet(PacketType::Floats, 1, 1),
        &array(vec![SonicValue::F64(n)]),
    );
    assert_eq!(f, array(vec![SonicValue::F32(n as f32)]));
    let d = roundtrip(
        &packet(PacketType::Doubles, 1, 1),
        &array(vec![SonicValue::F64(n)]),
    );
    let SonicValue::Array(v) = d else { panic!() };
    let SonicValue::F64(actual) = v[0] else {
        panic!()
    };
    assert!((actual - n).abs() < 1e-9);
}

#[test]
fn ascii_empty_list() {
    let v = array(vec![]);
    let data = encode_packet(&packet(PacketType::StringsAscii, 0, 0), &v).unwrap();
    assert_eq!(data, [0]);
    assert_eq!(
        decode_packet(&packet(PacketType::StringsAscii, 0, 0), &data).unwrap(),
        v
    );
}
#[test]
fn ascii_empty_string() {
    let v = array(vec![SonicValue::String(String::new())]);
    assert_eq!(roundtrip(&packet(PacketType::StringsAscii, 1, 1), &v), v);
}
#[test]
fn ascii_single_char_padding_cases() {
    for (value, golden) in [
        ("a", "0101a2"),
        ("e", "0101a8"),
        (" ", "010100"),
        ("\n", "010102"),
        ("Z", "01011e"),
    ] {
        assert_eq!(
            hex::encode(&strings::encode_ascii(&[value.into()]).unwrap()),
            golden
        );
    }
}
#[test]
fn ascii_reject_nonzero_padding() {
    assert!(strings::decode_ascii(&[1, 1, 0xa3]).is_err());
    assert!(validate_packet(&packet(PacketType::StringsAscii, 1, 1), &[1, 1, 0xa3]).is_err());
}
#[test]
fn ascii_reject_unsupported_char() {
    assert!(strings::encode_ascii(&["😂".into()]).is_err());
}
#[test]
fn utf16_astral_characters() {
    let strings = vec!["another😂", "𐍈", "𝄞", "🧪"]
        .into_iter()
        .map(|v| SonicValue::String(v.into()))
        .collect();
    let v = array(strings);
    assert_eq!(roundtrip(&packet(PacketType::StringsUtf16, 4, 4), &v), v);
}
#[test]
fn utf16_reject_invalid_code_point() {
    let data = [1, 0x80, 0x80, 0x44];
    assert!(validate_packet(&packet(PacketType::StringsUtf16, 1, 1), &data).is_err());
    assert!(decode_packet(&packet(PacketType::StringsUtf16, 1, 1), &data).is_err());
}

#[test]
fn hex_reject_odd_length() {
    assert!(
        encode_packet(
            &packet(PacketType::Hex, 1, 1),
            &SonicValue::String("abc".into())
        )
        .is_err()
    );
}
#[test]
fn hex_reject_invalid_character() {
    assert!(
        encode_packet(
            &packet(PacketType::Hex, 1, 1),
            &SonicValue::String("zz".into())
        )
        .is_err()
    );
}
#[test]
fn none_empty_valid() {
    let def = packet(PacketType::None, 0, 0);
    let data = encode_packet(&def, &SonicValue::Undefined).unwrap();
    assert!(data.is_empty());
    assert!(validate_packet(&def, &data).is_ok());
    assert_eq!(decode_packet(&def, &data).unwrap(), SonicValue::Undefined);
}
#[test]
fn none_nonempty_invalid() {
    let def = packet(PacketType::None, 0, 0);
    assert!(validate_packet(&def, &[1]).is_err());
    assert!(decode_packet(&def, &[1]).is_err());
}
#[test]
fn none_rejects_wrong_value() {
    assert!(
        encode_packet(
            &packet(PacketType::None, 0, 0),
            &SonicValue::String("oops".into())
        )
        .is_err()
    );
}

fn enum_packet(values: Vec<EnumValue>) -> PacketDef {
    let mut p = packet(PacketType::Enums, 0, 255);
    p.enum_data.push(EnumPackage {
        name: "values".into(),
        values,
    });
    p
}
#[test]
fn enum_string_values() {
    let def = enum_packet(vec!["red".into(), "green".into(), "blue".into()]);
    let v = array(vec![
        SonicValue::String("red".into()),
        SonicValue::String("blue".into()),
        SonicValue::String("green".into()),
    ]);
    let data = encode_packet(&def, &v).unwrap();
    assert_eq!(data, [0, 2, 1]);
    assert_eq!(decode_packet(&def, &data).unwrap(), v);
}
#[test]
fn enum_mixed_values() {
    let def = enum_packet(vec![
        "yes".into(),
        EnumValue::Number(1.0),
        EnumValue::Bool(true),
        EnumValue::Null,
        EnumValue::Undefined,
    ]);
    let v = array(vec![
        SonicValue::String("yes".into()),
        SonicValue::F64(1.0),
        SonicValue::Bool(true),
        SonicValue::Null,
        SonicValue::Undefined,
    ]);
    assert_eq!(roundtrip(&def, &v), v);
}
#[test]
fn enum_unknown_value() {
    assert!(
        encode_packet(
            &enum_packet(vec!["yes".into()]),
            &array(vec![SonicValue::String("no".into())])
        )
        .is_err()
    );
}
#[test]
fn enum_index_out_of_range() {
    assert!(
        validate_packet(
            &enum_packet(vec!["a".into(), "b".into(), "c".into()]),
            &[0, 1, 3]
        )
        .is_err()
    );
}

fn object(
    types: Vec<PacketType>,
    mins: Vec<u64>,
    maxes: Vec<u64>,
    enums: Vec<EnumPackage>,
) -> PacketDef {
    PacketDef {
        tag: "object".into(),
        schema: PacketSchema {
            object: true,
            packet_type: SchemaType::Object(types),
            data_min: SchemaLimit::Object(mins),
            data_max: SchemaLimit::Object(maxes),
            data_batching: 0,
            max_batch_size: 0,
            dont_spread: true,
            auto_flatten: false,
            rereference: false,
            gzip_compression: false,
        },
        enum_data: enums,
    }
}
#[test]
fn object_deterministic_exact_bytes() {
    let def = object(
        vec![
            PacketType::StringsAscii,
            PacketType::Booleans,
            PacketType::Bytes,
        ],
        vec![2, 4, 3],
        vec![2, 4, 3],
        vec![],
    );
    let fields = vec![
        array(vec![
            SonicValue::String("hello".into()),
            SonicValue::String("world".into()),
        ]),
        array(vec![
            SonicValue::Bool(true),
            SonicValue::Bool(false),
            SonicValue::Bool(true),
            SonicValue::Bool(false),
        ]),
        signed(&[-1, 0, 1]),
    ];
    let data = encode_object(&def, &fields).unwrap();
    assert_eq!(hex::encode(&data), "0c02050595523469f067c98d1c01a003010002");
    assert_eq!(decode_object(&def, &data).unwrap(), fields);
}
#[test]
fn object_missing_sector() {
    let def = object(
        vec![PacketType::UBytes, PacketType::UBytes],
        vec![1, 1],
        vec![1, 1],
        vec![],
    );
    assert!(validate_packet(&def, &[1, 7]).is_err());
}
#[test]
fn object_extra_sector() {
    let def = object(vec![PacketType::UBytes], vec![1], vec![1], vec![]);
    assert!(validate_packet(&def, &[1, 7, 1, 0xff]).is_err());
}
#[test]
fn object_sector_length_too_long() {
    let def = object(vec![PacketType::UBytes], vec![1], vec![2], vec![]);
    assert!(validate_packet(&def, &[2, 7]).is_err());
}
#[test]
fn object_enum_package_order() {
    let enums = vec![
        EnumPackage {
            name: "first".into(),
            values: vec!["a".into(), "b".into()],
        },
        EnumPackage {
            name: "second".into(),
            values: vec!["x".into(), "y".into(), "z".into()],
        },
    ];
    let def = object(
        vec![PacketType::Enums, PacketType::Bytes, PacketType::Enums],
        vec![1, 1, 1],
        vec![1, 1, 1],
        enums,
    );
    let fields = vec![
        array(vec![SonicValue::String("b".into())]),
        signed(&[-1]),
        array(vec![SonicValue::String("z".into())]),
    ];
    let data = encode_object(&def, &fields).unwrap();
    assert_eq!(data, [1, 1, 1, 1, 1, 2]);
    assert_eq!(decode_object(&def, &data).unwrap(), fields);
}

#[test]
fn batch_uncompressed_roundtrip() {
    let v = vec![vec![1, 2, 3], vec![], vec![255]];
    assert_eq!(
        decode_batches_limited(&encode_batches(&v).unwrap(), 0).unwrap(),
        v
    );
}
#[test]
fn batch_compressed_roundtrip() {
    let mut def = packet(PacketType::Raw, 0, 10);
    def.schema.data_batching = 1;
    def.schema.gzip_compression = true;
    let v = vec![vec![1, 2, 3], vec![], vec![255]];
    let data = encode_for_packet(&def, &v).unwrap();
    assert_eq!(
        sonic_ws_core::batching::decode_for_packet(&def, &data).unwrap(),
        v
    );
}
#[test]
fn batch_max_count_enforced() {
    let data = encode_batches(&[vec![1], vec![2], vec![3]]).unwrap();
    assert!(decode_batches_limited(&data, 2).is_err());
}
#[test]
fn validate_batched_packets() {
    let mut def = packet(PacketType::UVarInt, 0, 10);
    def.schema.data_batching = 1;
    def.schema.max_batch_size = 3;
    let payloads = vec![varint::encode(1), varint::encode(128), varint::encode(255)];
    let data = encode_for_packet(&def, &payloads).unwrap();
    assert!(validate_batched(&def, &data).is_ok());
    let bad = encode_for_packet(&def, &[varint::encode(1), vec![0x80]]).unwrap();
    assert!(validate_batched(&def, &bad).is_err());
}
#[test]
fn validate_compressed_batched_packets() {
    let mut def = packet(PacketType::UVarInt, 0, 10);
    def.schema.data_batching = 1;
    def.schema.max_batch_size = 3;
    def.schema.gzip_compression = true;
    let data = encode_for_packet(&def, &[varint::encode(1), varint::encode(128)]).unwrap();
    assert!(validate_batched(&def, &data).is_ok());
    let bad = encode_for_packet(&def, &[vec![0x80]]).unwrap();
    assert!(validate_batched(&def, &bad).is_err());
}
#[test]
fn raw_preserves_arbitrary_bytes() {
    let bytes = (0..=255).collect::<Vec<u8>>();
    let def = packet(PacketType::Raw, 0, 256);
    let data = encode_packet(&def, &SonicValue::Bytes(bytes.clone())).unwrap();
    assert_eq!(
        decode_packet(&def, &data).unwrap(),
        SonicValue::Bytes(bytes)
    );
}
#[test]
fn range_below_minimum() {
    let data = [1, 2];
    assert!(validate_packet(&packet(PacketType::UVarInt, 3, 5), &data).is_err());
}
#[test]
fn range_above_maximum() {
    let data = [1, 2, 3, 4];
    assert!(validate_packet(&packet(PacketType::UVarInt, 0, 3), &data).is_err());
}

#[test]
fn varint_fixture_is_well_formed() {
    let bytes = varint::encode(u32::MAX as u64);
    assert_eq!(
        varint::decode(&mut Reader::new(&bytes)).unwrap(),
        u32::MAX as u64
    );
}
