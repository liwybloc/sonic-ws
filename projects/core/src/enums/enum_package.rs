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

use crate::{Error, Result, SonicValue};

#[derive(Debug, Clone)]
pub enum EnumValue {
    String(String),
    Number(f64),
    Bool(bool),
    Undefined,
    Null,
}

impl PartialEq for EnumValue {
    fn eq(&self, other: &Self) -> bool {
        match (self, other) {
            (Self::String(a), Self::String(b)) => a == b,
            (Self::Number(a), Self::Number(b)) => a == b || (a.is_nan() && b.is_nan()),
            (Self::Bool(a), Self::Bool(b)) => a == b,
            (Self::Undefined, Self::Undefined) | (Self::Null, Self::Null) => true,
            _ => false,
        }
    }
}

impl EnumValue {
    pub fn from_sonic(value: &SonicValue) -> Result<Self> {
        Ok(match value {
            SonicValue::String(value) => Self::String(value.clone()),
            SonicValue::I64(value) => Self::Number(*value as f64),
            SonicValue::U64(value) => Self::Number(*value as f64),
            SonicValue::F32(value) => Self::Number(f64::from(*value)),
            SonicValue::F64(value) => Self::Number(*value),
            SonicValue::Bool(value) => Self::Bool(*value),
            SonicValue::Undefined => Self::Undefined,
            SonicValue::Null => Self::Null,
            SonicValue::Bytes(_) | SonicValue::Array(_) | SonicValue::Object(_) => {
                return Err(Error::InvalidData("unsupported enum value type"));
            }
        })
    }

    pub fn to_sonic(&self) -> SonicValue {
        match self {
            Self::String(v) => SonicValue::String(v.clone()),
            Self::Number(v) => SonicValue::F64(*v),
            Self::Bool(v) => SonicValue::Bool(*v),
            Self::Undefined => SonicValue::Undefined,
            Self::Null => SonicValue::Null,
        }
    }
}

impl From<String> for EnumValue {
    fn from(value: String) -> Self {
        Self::String(value)
    }
}
impl From<&str> for EnumValue {
    fn from(value: &str) -> Self {
        Self::String(value.into())
    }
}
impl From<f64> for EnumValue {
    fn from(value: f64) -> Self {
        Self::Number(value)
    }
}
impl From<bool> for EnumValue {
    fn from(value: bool) -> Self {
        Self::Bool(value)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct EnumPackage {
    pub name: String,
    pub values: Vec<EnumValue>,
}
