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

use sonic_ws_core::enums::{EnumPackage, EnumValue, decode_enum, encode_enum};
#[test]
fn resolves_enum_values() {
    let package = EnumPackage {
        name: "state".into(),
        values: vec!["open".into()],
    };
    assert_eq!(encode_enum(0).unwrap(), 0);
    assert_eq!(
        decode_enum(&package, 0).unwrap(),
        &EnumValue::String("open".into())
    );
}

#[test]
fn supports_every_typescript_enum_value_type() {
    let package = EnumPackage {
        name: "mixed".into(),
        values: vec![
            EnumValue::String("one".into()),
            EnumValue::Number(2.5),
            EnumValue::Number(f64::NAN),
            EnumValue::Bool(true),
            EnumValue::Undefined,
            EnumValue::Null,
        ],
    };
    for (index, expected) in package.values.iter().enumerate() {
        assert_eq!(
            decode_enum(&package, encode_enum(index).unwrap()).unwrap(),
            expected
        );
    }
}
