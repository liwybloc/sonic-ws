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

use sonic_ws_core::wire::{Reader, Writer};
#[test]
fn wire_roundtrip() {
    let mut writer = Writer::new();
    writer.write_all(&[1, 2, 3]);
    let mut reader = Reader::new(writer.as_slice());
    assert_eq!(reader.read_exact(3).unwrap(), [1, 2, 3]);
}
