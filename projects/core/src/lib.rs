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

pub mod batching;
pub mod codec;
pub mod compression;
pub mod enums;
pub mod error;
pub mod ffi;
pub mod object;
pub mod packet;
pub mod packet_type;
pub mod primitives;
pub mod schema;
pub mod value;
pub mod wire;

pub use error::{Error, Result};
pub use packet::PacketDef;
pub use packet_type::PacketType;
pub use schema::{PacketSchema, SchemaLimit, SchemaType};
pub use value::SonicValue;
