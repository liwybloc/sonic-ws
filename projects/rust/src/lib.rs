//! Native Rust runtime for SonicWS protocol version 25.
//!
//! [`Packet`] and [`PacketRegistry`] are transport-independent. [`Client`] and
//! [`Server`] add an asynchronous WebSocket transport using Tokio.

mod connection;
mod control;
mod error;
mod json;
mod listener;
mod packet;
mod registry;
mod server;
mod variant_permutation;

pub use connection::{Client, ClientConfig, Connection, Event, Incoming, ReconnectConfig, Request};
pub use error::{Error, Result};
pub use listener::Listeners;
pub use packet::{
    Group, ObjectPacketBuilder, Packet, PacketBuilder, Quantization, ValueRange, packet_group,
    permutation_packet_group,
};
pub use registry::PacketRegistry;
pub use server::{Server, ServerConfig};
pub use sonic_ws_core::enums::{EnumPackage, EnumValue};
pub use sonic_ws_core::{PacketType, SonicValue};
pub use variant_permutation::VariantPermutation;

/// SonicWS wire protocol version supported by this crate.
pub const PROTOCOL_VERSION: u8 = 25;
