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
    codec::encode::encode_packet,
    enums::{EnumPackage, EnumValue},
    object::{decode::decode as decode_object, encode::encode as encode_object},
};

fn packet(kind: PacketType) -> PacketDef {
    PacketDef {
        tag: "test".into(),
        schema: PacketSchema {
            object: false,
            packet_type: SchemaType::Single(kind),
            data_min: SchemaLimit::Single(0),
            data_max: SchemaLimit::Single(32),
            data_batching: 0,
            max_batch_size: 10,
            dont_spread: false,
            auto_flatten: false,
            rereference: false,
            gzip_compression: false,
        },
        enum_data: vec![],
    }
}
fn array(values: Vec<SonicValue>) -> SonicValue {
    SonicValue::Array(values)
}

#[test]
fn encodes_every_supported_single_packet_mode() {
    let cases = [
        (PacketType::None, array(vec![]), vec![]),
        (
            PacketType::Raw,
            SonicValue::Bytes(vec![1, 2, 3]),
            vec![1, 2, 3],
        ),
        (
            PacketType::StringsAscii,
            array(vec![SonicValue::String("abc".into())]),
            vec![1, 3, 0xa2, 0xea, 0x28],
        ),
        (
            PacketType::StringsUtf16,
            array(vec![SonicValue::String("A".into())]),
            vec![1, 65],
        ),
        (
            PacketType::Bytes,
            array(vec![SonicValue::I64(-1), SonicValue::I64(1)]),
            vec![1, 2],
        ),
        (
            PacketType::UBytes,
            array(vec![SonicValue::U64(0), SonicValue::U64(255)]),
            vec![0, 255],
        ),
        (
            PacketType::Shorts,
            array(vec![SonicValue::I64(-1), SonicValue::I64(1)]),
            vec![0, 1, 0, 2],
        ),
        (
            PacketType::UShorts,
            array(vec![SonicValue::U64(0x1234)]),
            vec![0x12, 0x34],
        ),
        (
            PacketType::VarInt,
            array(vec![SonicValue::I64(-1), SonicValue::I64(64)]),
            vec![1, 128, 1],
        ),
        (
            PacketType::UVarInt,
            array(vec![SonicValue::U64(128)]),
            vec![128, 1],
        ),
        (
            PacketType::Deltas,
            array(vec![
                SonicValue::I64(10),
                SonicValue::I64(13),
                SonicValue::I64(8),
            ]),
            vec![20, 6, 9],
        ),
        (
            PacketType::Floats,
            array(vec![SonicValue::F32(1.5)]),
            vec![0x3f, 0xc0, 0, 0],
        ),
        (
            PacketType::Doubles,
            array(vec![SonicValue::F64(1.5)]),
            vec![0x3c, 0xcc, 0, 0, 0, 0, 0, 0],
        ),
        (
            PacketType::Booleans,
            array(vec![SonicValue::Bool(true), SonicValue::Bool(false)]),
            vec![0x80],
        ),
        (
            PacketType::Hex,
            SonicValue::String("00abff".into()),
            vec![0, 0xab, 0xff],
        ),
    ];
    for (kind, value, expected) in cases {
        assert_eq!(
            encode_packet(&packet(kind), &value).unwrap(),
            expected,
            "{kind:?}"
        );
    }
}

#[test]
fn encodes_enum_mode() {
    let mut definition = packet(PacketType::Enums);
    definition.enum_data.push(EnumPackage {
        name: "state".into(),
        values: vec!["open".into(), "closed".into()],
    });
    assert_eq!(
        encode_packet(
            &definition,
            &array(vec![SonicValue::String("closed".into())])
        )
        .unwrap(),
        [1]
    );
}

#[test]
fn mixed_enum_values_roundtrip_through_packet_codec() {
    use sonic_ws_core::codec::decode::decode_packet;
    let mut definition = packet(PacketType::Enums);
    definition.enum_data.push(EnumPackage {
        name: "mixed".into(),
        values: vec![
            EnumValue::String("x".into()),
            EnumValue::Number(2.5),
            EnumValue::Bool(true),
            EnumValue::Undefined,
            EnumValue::Null,
        ],
    });
    let values = array(vec![
        SonicValue::String("x".into()),
        SonicValue::F64(2.5),
        SonicValue::Bool(true),
        SonicValue::Undefined,
        SonicValue::Null,
    ]);
    let encoded = encode_packet(&definition, &values).unwrap();
    assert_eq!(encoded, [0, 1, 2, 3, 4]);
    assert_eq!(decode_packet(&definition, &encoded).unwrap(), values);
}

#[test]
fn reserved_16_is_an_opaque_application_codec_sector() {
    use sonic_ws_core::{codec::decode::decode_packet, codec::validate::validate_packet};

    let definition = packet(PacketType::Reserved16);
    let value = SonicValue::Bytes(vec![0, 1, 128, 255]);
    let encoded = encode_packet(&definition, &value).unwrap();

    assert_eq!(encoded, [0, 1, 128, 255]);
    validate_packet(&definition, &encoded).unwrap();
    assert_eq!(decode_packet(&definition, &encoded).unwrap(), value);
}

#[test]
fn rejects_narrow_integer_overflow_and_accepts_full_u64_varints() {
    assert!(
        encode_packet(
            &packet(PacketType::Bytes),
            &array(vec![SonicValue::I64(128)])
        )
        .is_err()
    );
    assert!(
        encode_packet(
            &packet(PacketType::Shorts),
            &array(vec![SonicValue::I64(32_768)])
        )
        .is_err()
    );
    assert_eq!(
        encode_packet(
            &packet(PacketType::UVarInt),
            &array(vec![SonicValue::U64(u64::MAX)])
        )
        .unwrap(),
        [0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 1]
    );
}

#[test]
fn object_mode_frames_each_sector() {
    let mut definition = packet(PacketType::None);
    definition.schema.object = true;
    definition.schema.packet_type =
        SchemaType::Object(vec![PacketType::UBytes, PacketType::Booleans]);
    definition.schema.data_min = SchemaLimit::Object(vec![1, 1]);
    definition.schema.data_max = SchemaLimit::Object(vec![2, 2]);
    let value = array(vec![
        array(vec![SonicValue::U64(7), SonicValue::U64(8)]),
        array(vec![SonicValue::Bool(true), SonicValue::Bool(false)]),
    ]);
    let fields = match &value {
        SonicValue::Array(fields) => fields,
        _ => unreachable!(),
    };
    let encoded = encode_object(&definition, fields).unwrap();
    assert_eq!(encoded, [2, 7, 8, 1, 0x80]);
    assert_eq!(
        decode_object(&definition, &encoded).unwrap(),
        fields.clone()
    );
}
