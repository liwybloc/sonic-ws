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

#[cfg(feature = "c-api")]
pub mod c_api;
#[cfg(feature = "python")]
pub mod python;
#[cfg(all(feature = "wasm", target_arch = "wasm32"))]
pub mod wasm;
