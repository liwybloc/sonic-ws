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

pub fn encode_f32(value: f32) -> [u8; 4] {
    let value = f64::from(value);
    let bits = if value.is_nan() {
        0x7f80_0001
    } else {
        let sign = u32::from(value < 0.0);
        let value = value.abs();
        if value == 0.0 {
            0
        } else {
            let exponent = value.log2().floor() as i32;
            if !value.is_finite() || !(-126..=127).contains(&exponent) {
                (sign << 31) | 0x7f80_0000
            } else {
                let mantissa =
                    ((value / 2_f64.powi(exponent) - 1.0) * 2_f64.powi(23)).round() as u32;
                (sign << 31) | (((exponent + 127) as u32) << 23) | (mantissa & 0x7f_ffff)
            }
        }
    };
    bits.to_be_bytes()
}

pub fn decode_f32(bytes: [u8; 4]) -> f32 {
    let bits = u32::from_be_bytes(bytes);
    let sign = bits >> 31;
    let raw = (bits >> 23) & 0xff;
    let fraction = bits & 0x7f_ffff;
    let mantissa = (if raw == 0 { 0.0 } else { 1.0 }) + (fraction as f64 / 2_f64.powi(23));
    let value = if raw == 0xff {
        if mantissa == 0.0 {
            f64::INFINITY
        } else {
            f64::NAN
        }
    } else {
        mantissa * 2_f64.powi(if raw == 0 { -126 } else { raw as i32 - 127 })
    };
    (if sign == 1 { -value } else { value }) as f32
}

pub fn encode_f64(value: f64) -> [u8; 8] {
    let sign = u64::from(value < 0.0);
    let bits = if value.is_nan() {
        (0x7ff_u64 << 52) | 1
    } else if !value.is_finite() {
        (sign << 63) | (0x7ff_u64 << 52)
    } else {
        let value = value.abs();
        let (exponent, significand) = if value == 0.0 {
            (0_i32, 0_u64)
        } else {
            let exponent = value.log2().floor() as i32 - 51;
            (exponent, (value / 2_f64.powi(exponent)).floor() as u64)
        };
        (sign << 63) | (((exponent + 1023) as u64) << 52) | (significand & 0x000f_ffff_ffff_ffff)
    };
    bits.to_be_bytes()
}

pub fn decode_f64(bytes: [u8; 8]) -> f64 {
    let bits = u64::from_be_bytes(bytes);
    let sign = bits >> 63;
    let raw = (bits >> 52) & 0x7ff;
    let mantissa = bits & 0x000f_ffff_ffff_ffff;
    let value = if raw == 0x7ff {
        if mantissa == 0 {
            f64::INFINITY
        } else {
            f64::NAN
        }
    } else {
        mantissa as f64 * 2_f64.powi(if raw == 0 { -1022 } else { raw as i32 - 1023 })
    };
    if sign == 1 { -value } else { value }
}
