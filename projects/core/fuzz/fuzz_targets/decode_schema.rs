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
use sonic_ws_core::wire::Reader;
fuzz_target!(|data: &[u8]| { let mut reader = Reader::new(data); while reader.read_u8().is_ok() {} });
