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

use crate::PacketType;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PacketSchema {
    pub object: bool,
    pub packet_type: SchemaType,
    pub data_min: SchemaLimit,
    pub data_max: SchemaLimit,
    pub data_batching: i32,
    pub max_batch_size: i32,
    pub dont_spread: bool,
    pub auto_flatten: bool,
    pub rereference: bool,
    pub gzip_compression: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SchemaType {
    Single(PacketType),
    Object(Vec<PacketType>),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SchemaLimit {
    Single(u64),
    Object(Vec<u64>),
}
