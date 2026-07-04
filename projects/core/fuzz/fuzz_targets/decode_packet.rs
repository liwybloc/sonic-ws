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

#![no_main]
use libfuzzer_sys::fuzz_target;
use sonic_ws_core::{PacketDef, PacketSchema, PacketType, SchemaLimit, SchemaType, codec::{decode::decode_packet, validate::validate_packet}};
fuzz_target!(|data: &[u8]| {
    let Some((&kind, payload)) = data.split_first() else { return };
    let kind = match kind {
        0 => PacketType::None, 1 => PacketType::Raw, 2 => PacketType::StringsAscii,
        3 => PacketType::StringsUtf16, 5 => PacketType::Bytes, 6 => PacketType::UBytes,
        7 => PacketType::Shorts, 8 => PacketType::UShorts, 9 => PacketType::VarInt,
        10 => PacketType::UVarInt, 11 => PacketType::Deltas, 12 => PacketType::Floats,
        13 => PacketType::Doubles, 14 => PacketType::Booleans, 16 => PacketType::Reserved16,
        17 => PacketType::Hex, _ => return,
    };
    let packet = PacketDef {
        tag: "fuzz".into(),
        schema: PacketSchema {
            object: false,
            packet_type: SchemaType::Single(kind),
            data_min: SchemaLimit::Single(0),
            data_max: SchemaLimit::Single(4096),
            data_batching: 0,
            max_batch_size: 64,
            dont_spread: false,
            auto_flatten: false,
            rereference: false,
            gzip_compression: false,
        },
        enum_data: vec![],
    };
    let _ = validate_packet(&packet, payload);
    let _ = decode_packet(&packet, payload);
});
