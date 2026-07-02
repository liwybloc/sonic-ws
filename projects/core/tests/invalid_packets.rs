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
    PacketDef, PacketSchema, PacketType, SchemaLimit, SchemaType,
    batching::encode_for_packet,
    codec::validate::{validate_batched, validate_packet},
    compression::gzip,
    enums::EnumPackage,
    object::validate::validate as validate_object,
    wire::Reader,
};

fn packet(kind: PacketType, min: u64, max: u64) -> PacketDef {
    PacketDef {
        tag: "validate".into(),
        schema: PacketSchema {
            object: false,
            packet_type: SchemaType::Single(kind),
            data_min: SchemaLimit::Single(min),
            data_max: SchemaLimit::Single(max),
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

#[test]
fn reader_rejects_truncated_reads() {
    assert!(Reader::new(&[1]).read_exact(2).is_err());
}

#[test]
fn validates_fixed_width_counts_and_alignment() {
    assert!(validate_packet(&packet(PacketType::UBytes, 1, 2), &[1, 2]).is_ok());
    assert!(validate_packet(&packet(PacketType::UBytes, 1, 2), &[1, 2, 3]).is_err());
    assert!(validate_packet(&packet(PacketType::Shorts, 1, 2), &[0, 1, 0]).is_err());
    assert!(validate_packet(&packet(PacketType::Floats, 1, 1), &[0; 3]).is_err());
    assert!(validate_packet(&packet(PacketType::Doubles, 1, 1), &[0; 8]).is_ok());
}

#[test]
fn validates_varints_booleans_and_strings() {
    assert!(validate_packet(&packet(PacketType::UVarInt, 1, 2), &[0x80]).is_err());
    assert!(validate_packet(&packet(PacketType::UVarInt, 1, 2), &[1, 2]).is_ok());
    assert!(validate_packet(&packet(PacketType::Booleans, 9, 16), &[0xff]).is_err());
    assert!(validate_packet(&packet(PacketType::Booleans, 9, 16), &[0xff, 0]).is_ok());
    assert!(validate_packet(&packet(PacketType::StringsAscii, 1, 1), &[1, 9]).is_err());
    assert!(validate_packet(&packet(PacketType::StringsAscii, 1, 1), &[1, 1, 0xff]).is_err());
    assert!(validate_packet(&packet(PacketType::StringsUtf16, 1, 1), &[1, 0x80]).is_err());
}

#[test]
fn validates_every_payload_inside_batches() {
    for compressed in [false, true] {
        let mut definition = packet(PacketType::UBytes, 2, 2);
        definition.schema.data_batching = 10;
        definition.schema.max_batch_size = 2;
        definition.schema.gzip_compression = compressed;
        let valid = encode_for_packet(&definition, &[vec![1, 2], vec![3, 4]]).unwrap();
        assert!(validate_batched(&definition, &valid).is_ok());
        let invalid = encode_for_packet(&definition, &[vec![1, 2], vec![3]]).unwrap();
        assert!(validate_batched(&definition, &invalid).is_err());
        let too_many =
            encode_for_packet(&definition, &[vec![1, 2], vec![3, 4], vec![5, 6]]).unwrap();
        assert!(validate_batched(&definition, &too_many).is_err());
    }
}

#[test]
fn validates_enum_indices() {
    let mut definition = packet(PacketType::Enums, 1, 2);
    definition.enum_data.push(EnumPackage {
        name: "state".into(),
        values: vec!["open".into(), "closed".into()],
    });
    assert!(validate_packet(&definition, &[0, 1]).is_ok());
    assert!(validate_packet(&definition, &[2]).is_err());
}

#[test]
fn decompresses_before_validating_single_packets() {
    let mut definition = packet(PacketType::UBytes, 2, 2);
    definition.schema.gzip_compression = true;
    let compressed = gzip::compress(&[7, 8]).unwrap();
    assert!(validate_packet(&definition, &compressed).is_ok());
    assert!(validate_packet(&definition, &[7, 8]).is_err());
}

#[test]
fn validates_each_object_sector() {
    let definition = PacketDef {
        tag: "object".into(),
        schema: PacketSchema {
            object: true,
            packet_type: SchemaType::Object(vec![PacketType::UBytes, PacketType::Booleans]),
            data_min: SchemaLimit::Object(vec![2, 2]),
            data_max: SchemaLimit::Object(vec![2, 2]),
            data_batching: 0,
            max_batch_size: 10,
            dont_spread: false,
            auto_flatten: false,
            rereference: false,
            gzip_compression: false,
        },
        enum_data: vec![],
    };
    assert!(validate_object(&definition, &[2, 7, 8, 1, 0x80]).is_ok());
    assert!(validate_object(&definition, &[1, 7, 1, 0x80]).is_err());
    assert!(validate_object(&definition, &[2, 7, 8]).is_err());
    assert!(validate_object(&definition, &[2, 7, 8, 1, 0x80, 0]).is_err());
}
