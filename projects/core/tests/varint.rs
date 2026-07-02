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

use sonic_ws_core::{primitives::varint, wire::Reader};
#[test]
fn roundtrips_varints() {
    for value in [0, 127, 128, u32::MAX as u64, u64::MAX] {
        let bytes = varint::encode(value);
        assert_eq!(varint::decode(&mut Reader::new(&bytes)).unwrap(), value);
    }
}
