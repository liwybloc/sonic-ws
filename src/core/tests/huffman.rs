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

use sonic_ws_core::primitives::strings;

#[test]
fn checks_every_byte_character_against_typescript_table() {
    const UNSUPPORTED: [u8; 8] = [0, 9, 11, 12, 13, 92, 160, 255];

    for byte in 0_u8..=u8::MAX {
        let value = char::from(byte).to_string();
        let values = vec![value.clone()];
        match strings::encode_ascii(&values) {
            Ok(encoded) => {
                assert!(
                    !UNSUPPORTED.contains(&byte),
                    "unexpected code for byte {byte}"
                );
                assert_eq!(
                    strings::decode_ascii(&encoded).unwrap(),
                    values,
                    "byte {byte}"
                );
            }
            Err(_) => assert!(UNSUPPORTED.contains(&byte), "missing code for byte {byte}"),
        }
    }
}
