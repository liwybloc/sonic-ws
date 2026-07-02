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
    batching::{
        decode_batches, decode_batches_limited, decode_for_packet, encode_batches,
        encode_for_packet,
    },
};

fn packet(compressed: bool, max_batch_size: i32) -> PacketDef {
    PacketDef {
        tag: "batch".into(),
        schema: PacketSchema {
            object: false,
            packet_type: SchemaType::Single(PacketType::Raw),
            data_min: SchemaLimit::Single(0),
            data_max: SchemaLimit::Single(100),
            data_batching: 10,
            max_batch_size,
            dont_spread: false,
            auto_flatten: false,
            rereference: false,
            gzip_compression: compressed,
        },
        enum_data: vec![],
    }
}

#[test]
fn matches_typescript_batch_framing() {
    let batches = vec![vec![1, 2, 3], vec![], vec![4; 128]];
    let encoded = encode_batches(&batches).unwrap();
    assert_eq!(&encoded[..7], [3, 1, 2, 3, 0, 0x80, 1]);
    assert_eq!(decode_batches(&encoded).unwrap(), batches);
}

#[test]
fn compresses_the_complete_batch_for_packet() {
    let definition = packet(true, 10);
    let batches = vec![b"first".to_vec(), b"second".to_vec()];
    let encoded = encode_for_packet(&definition, &batches).unwrap();
    assert_eq!(decode_for_packet(&definition, &encoded).unwrap(), batches);
}

#[test]
fn enforces_batch_limit() {
    let encoded = encode_batches(&[vec![1], vec![2]]).unwrap();
    assert!(decode_batches_limited(&encoded, 1).is_err());
    assert_eq!(decode_batches_limited(&encoded, 0).unwrap().len(), 2);
}

#[test]
fn rejects_tampered_lengths_and_varints() {
    assert!(decode_batches(&[3, 1, 2]).is_err());
    assert!(decode_batches(&[0x80]).is_err());
}

#[test]
fn compressed_batch_rejects_expansion_beyond_schema_bound() {
    let definition = packet(true, 2);
    let expanded = encode_batches(&[vec![b'A'; 1000]]).unwrap();
    let compressed = sonic_ws_core::compression::gzip::compress(&expanded).unwrap();
    assert!(decode_for_packet(&definition, &compressed).is_err());
}
