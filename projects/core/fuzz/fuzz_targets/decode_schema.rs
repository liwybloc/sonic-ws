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
use sonic_ws_core::{PacketDef, PacketSchema, PacketType, SchemaLimit, SchemaType, object::{decode::decode, validate::validate}};
fuzz_target!(|data: &[u8]| {
    for sectors in 0..=16 {
        let packet = PacketDef {
            tag: "fuzz-object".into(),
            schema: PacketSchema {
                object: true,
                packet_type: SchemaType::Object(vec![PacketType::Raw; sectors]),
                data_min: SchemaLimit::Object(vec![0; sectors]),
                data_max: SchemaLimit::Object(vec![4096; sectors]),
                data_batching: 0, max_batch_size: 0, dont_spread: false,
                auto_flatten: false, rereference: false, gzip_compression: false,
            },
            enum_data: vec![],
        };
        let _ = decode(&packet, data);
        let _ = validate(&packet, data);
    }
});
