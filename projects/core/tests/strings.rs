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

use sonic_ws_core::primitives::{hex, strings};
#[test]
fn roundtrips_utf16() {
    let value = "Sonic 🚀";
    assert_eq!(
        strings::decode_utf16(&strings::encode_utf16(value)).unwrap(),
        value
    );
}

#[test]
fn ascii_matches_typescript_fixture() {
    let values = vec!["hello world".to_owned(), "SonicWS".to_owned()];
    let encoded = strings::encode_ascii(&values).unwrap();
    assert_eq!(
        hex::encode(&encoded),
        "020b0795523469e01067c98d1d4cf9b3a29e52"
    );
    assert_eq!(strings::decode_ascii(&encoded).unwrap(), values);
}
