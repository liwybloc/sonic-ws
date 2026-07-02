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

use super::{EnumPackage, EnumValue};
use crate::{Error, Result};

pub fn decode_enum(package: &EnumPackage, index: u8) -> Result<&EnumValue> {
    package
        .values
        .get(index as usize)
        .ok_or(Error::InvalidData("enum index is out of range"))
}
