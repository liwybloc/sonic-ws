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

use sonic_ws_core::SonicValue;
#[test]
fn represents_object_values() {
    let value = SonicValue::Object(vec![("ok".into(), SonicValue::Bool(true))]);
    assert!(matches!(value, SonicValue::Object(_)));
}
