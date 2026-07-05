use std::{collections::HashMap, sync::Arc};

use sonic_ws_core::{
    PacketDef, PacketSchema, PacketType, SchemaLimit, SchemaType,
    enums::{EnumPackage, EnumValue},
};

use crate::{Error, Packet, Result, packet::Metadata};

/// Ordered packet table used to map tags to one-byte wire keys.
#[derive(Debug, Clone, Default)]
pub struct PacketRegistry {
    packets: Vec<Arc<Packet>>,
    tags: HashMap<String, u8>,
}

impl PacketRegistry {
    pub fn new(packets: impl IntoIterator<Item = Packet>) -> Result<Self> {
        let mut registry = Self::default();
        for packet in packets {
            registry.push(packet)?;
        }
        Ok(registry)
    }

    pub fn push(&mut self, packet: Packet) -> Result<u8> {
        if self.packets.len() >= 255 {
            return Err(Error::Schema(
                "a registry supports at most 255 packets".into(),
            ));
        }
        if self.tags.contains_key(&packet.definition.tag) {
            return Err(Error::Schema(format!(
                "duplicate packet tag \"{}\"",
                packet.definition.tag
            )));
        }
        let key = u8::try_from(self.packets.len() + 1).expect("packet count checked");
        self.tags.insert(packet.definition.tag.clone(), key);
        self.packets.push(Arc::new(packet));
        Ok(key)
    }

    pub fn len(&self) -> usize {
        self.packets.len()
    }
    pub fn is_empty(&self) -> bool {
        self.packets.is_empty()
    }
    pub fn packets(&self) -> impl ExactSizeIterator<Item = &Arc<Packet>> {
        self.packets.iter()
    }
    pub fn key(&self, tag: &str) -> Option<u8> {
        self.tags.get(tag).copied()
    }
    pub fn by_tag(&self, tag: &str) -> Option<&Arc<Packet>> {
        self.key(tag).and_then(|key| self.by_key(key))
    }
    pub fn by_key(&self, key: u8) -> Option<&Arc<Packet>> {
        key.checked_sub(1)
            .and_then(|index| self.packets.get(index as usize))
    }

    pub fn permutation_tag_flags(&self, parent: &str, flags: &[bool]) -> Result<String> {
        let values = self.permutation_values(parent)?;
        if flags.len() != values.len() {
            return Err(Error::Value(format!(
                "variant permutation requires {} boolean flags",
                values.len()
            )));
        }
        let enabled = values
            .iter()
            .zip(flags)
            .filter_map(|(value, enabled)| enabled.then_some(value.as_str()))
            .collect::<std::collections::HashSet<_>>();
        self.find_permutation_tag(parent, &enabled)
    }

    pub fn permutation_tag_map(
        &self,
        parent: &str,
        flags: &HashMap<String, bool>,
    ) -> Result<String> {
        let values = self.permutation_values(parent)?;
        if flags.len() != values.len() || flags.keys().any(|key| !values.contains(key)) {
            return Err(Error::Value(
                "variant permutation map must define every known key".into(),
            ));
        }
        let enabled = values
            .iter()
            .filter_map(|value| flags[value].then_some(value.as_str()))
            .collect::<std::collections::HashSet<_>>();
        self.find_permutation_tag(parent, &enabled)
    }

    fn permutation_values(&self, parent: &str) -> Result<&[String]> {
        self.by_tag(parent)
            .and_then(|packet| packet.group.as_ref())
            .and_then(|group| group.permutation.as_deref())
            .ok_or_else(|| {
                Error::Value(format!(
                    "packet group \"{parent}\" does not define a VariantPermutation"
                ))
            })
    }

    fn find_permutation_tag(
        &self,
        parent: &str,
        enabled: &std::collections::HashSet<&str>,
    ) -> Result<String> {
        if enabled.is_empty() {
            return Ok(parent.to_owned());
        }
        self.packets
            .iter()
            .find_map(|packet| {
                let group = packet.group.as_ref()?;
                if group.parent != parent || group.variant.is_empty() {
                    return None;
                }
                let selected = group
                    .variant
                    .split(',')
                    .collect::<std::collections::HashSet<_>>();
                (selected == *enabled).then(|| packet.definition.tag.clone())
            })
            .ok_or_else(|| Error::Value("permutation contains an opposite combination".into()))
    }

    /// Serializes the table exactly as TypeScript and Python handshake tables do.
    pub fn serialize(&self) -> Result<Vec<u8>> {
        let mut output = Vec::new();
        for packet in &self.packets {
            serialize_packet(packet, &mut output)?;
        }
        Ok(output)
    }

    pub fn deserialize(bytes: &[u8]) -> Result<Self> {
        let mut cursor = Cursor::new(bytes);
        let mut packets = Vec::new();
        while !cursor.is_empty() {
            packets.push(deserialize_packet(&mut cursor)?);
        }
        Self::new(packets)
    }
}

fn serialize_packet(packet: &Packet, out: &mut Vec<u8>) -> Result<()> {
    write_latin1(&packet.definition.tag, out)?;
    let schema = &packet.definition.schema;
    let flags = [
        schema.dont_spread,
        false,
        schema.object,
        schema.auto_flatten,
        schema.gzip_compression,
        schema.rereference,
    ]
    .into_iter()
    .enumerate()
    .fold(0_u8, |byte, (index, value)| {
        byte | (u8::from(value) << (7 - index))
    });
    out.push(flags);

    let metadata = serde_json::to_vec(&packet.metadata())?;
    write_varint(metadata.len() as u64, out);
    out.extend(metadata);
    out.push(
        u8::try_from(schema.data_batching)
            .map_err(|_| Error::Schema("batching delay must fit in one byte".into()))?,
    );
    out.push(
        u8::try_from(packet.definition.enum_data.len())
            .map_err(|_| Error::Schema("too many enum packages".into()))?,
    );
    for package in &packet.definition.enum_data {
        serialize_enum(package, out)?;
    }

    match (&schema.packet_type, &schema.data_max, &schema.data_min) {
        (SchemaType::Single(kind), SchemaLimit::Single(max), SchemaLimit::Single(min)) => {
            write_varint(*max, out);
            write_varint(*min, out);
            out.push(*kind as u8);
        }
        (SchemaType::Object(types), SchemaLimit::Object(maxes), SchemaLimit::Object(mins)) => {
            if types.len() != maxes.len() || types.len() != mins.len() || types.len() > 255 {
                return Err(Error::Schema("object schema lengths do not match".into()));
            }
            out.push(types.len() as u8);
            for max in maxes {
                write_varint(*max, out);
            }
            for min in mins {
                write_varint(*min, out);
            }
            out.extend(types.iter().map(|kind| *kind as u8));
        }
        _ => {
            return Err(Error::Schema(
                "schema type and range shapes do not match".into(),
            ));
        }
    }
    Ok(())
}

fn deserialize_packet(cursor: &mut Cursor<'_>) -> Result<Packet> {
    let tag = cursor.read_latin1()?;
    let flags = cursor.u8()?;
    let metadata_length = cursor.varint_usize()?;
    let metadata: Metadata = serde_json::from_slice(cursor.take(metadata_length)?)?;
    let batching = i32::from(cursor.u8()?);
    let enum_count = cursor.u8()?;
    let mut enums = Vec::with_capacity(enum_count as usize);
    for _ in 0..enum_count {
        enums.push(deserialize_enum(cursor)?);
    }

    let object = flags & 0x20 != 0;
    let (packet_type, data_min, data_max) = if object {
        let count = cursor.u8()? as usize;
        let maxes = (0..count)
            .map(|_| cursor.varint())
            .collect::<Result<Vec<_>>>()?;
        let mins = (0..count)
            .map(|_| cursor.varint())
            .collect::<Result<Vec<_>>>()?;
        let types = (0..count)
            .map(|_| packet_type(cursor.u8()?))
            .collect::<Result<Vec<_>>>()?;
        (
            SchemaType::Object(types),
            SchemaLimit::Object(mins),
            SchemaLimit::Object(maxes),
        )
    } else {
        let max = cursor.varint()?;
        let min = cursor.varint()?;
        (
            SchemaType::Single(packet_type(cursor.u8()?)?),
            SchemaLimit::Single(min),
            SchemaLimit::Single(max),
        )
    };

    Ok(Packet::from_parts(
        PacketDef {
            tag,
            schema: PacketSchema {
                object,
                packet_type,
                data_min,
                data_max,
                data_batching: batching,
                max_batch_size: 10,
                dont_spread: flags & 0x80 != 0,
                auto_flatten: flags & 0x10 != 0,
                gzip_compression: flags & 0x08 != 0,
                rereference: flags & 0x04 != 0,
            },
            enum_data: enums,
        },
        metadata,
    ))
}

fn serialize_enum(package: &EnumPackage, out: &mut Vec<u8>) -> Result<()> {
    write_latin1(&package.name, out)?;
    out.push(
        u8::try_from(package.values.len())
            .map_err(|_| Error::Schema("enum supports at most 255 values".into()))?,
    );
    for value in &package.values {
        let (kind, text) = match value {
            EnumValue::String(value) => (0, value.clone()),
            EnumValue::Number(value) => (1, value.to_string()),
            EnumValue::Bool(value) => (2, value.to_string()),
            EnumValue::Undefined => (3, "undefined".into()),
            EnumValue::Null => (4, "null".into()),
        };
        write_latin1(&text, out)?;
        let length_index = out.len() - text.len() - 1;
        out.insert(length_index + 1, kind);
    }
    Ok(())
}

fn deserialize_enum(cursor: &mut Cursor<'_>) -> Result<EnumPackage> {
    let name = cursor.read_latin1()?;
    let count = cursor.u8()?;
    let mut values = Vec::with_capacity(count as usize);
    for _ in 0..count {
        let length = cursor.u8()? as usize;
        let kind = cursor.u8()?;
        let text = latin1(cursor.take(length)?);
        values.push(match kind {
            0 => EnumValue::String(text),
            1 => EnumValue::Number(
                text.parse()
                    .map_err(|_| Error::Protocol("invalid enum number".into()))?,
            ),
            2 => EnumValue::Bool(text == "true"),
            3 => EnumValue::Undefined,
            4 => EnumValue::Null,
            _ => return Err(Error::Protocol("invalid enum value type".into())),
        });
    }
    Ok(EnumPackage { name, values })
}

fn write_latin1(value: &str, out: &mut Vec<u8>) -> Result<()> {
    let bytes = value
        .chars()
        .map(|character| {
            u8::try_from(u32::from(character))
                .map_err(|_| Error::Schema("schema text must be Latin-1".into()))
        })
        .collect::<Result<Vec<_>>>()?;
    out.push(
        u8::try_from(bytes.len())
            .map_err(|_| Error::Schema("schema text exceeds 255 bytes".into()))?,
    );
    out.extend(bytes);
    Ok(())
}

fn latin1(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| char::from(*byte)).collect()
}
fn write_varint(mut value: u64, output: &mut Vec<u8>) {
    loop {
        let mut byte = (value & 0x7f) as u8;
        value >>= 7;
        if value != 0 {
            byte |= 0x80;
        }
        output.push(byte);
        if value == 0 {
            break;
        }
    }
}
fn packet_type(value: u8) -> Result<PacketType> {
    Ok(match value {
        0 => PacketType::None,
        1 => PacketType::Raw,
        2 => PacketType::StringsAscii,
        3 => PacketType::StringsUtf16,
        4 => PacketType::Enums,
        5 => PacketType::Bytes,
        6 => PacketType::UBytes,
        7 => PacketType::Shorts,
        8 => PacketType::UShorts,
        9 => PacketType::VarInt,
        10 => PacketType::UVarInt,
        11 => PacketType::Deltas,
        12 => PacketType::Floats,
        13 => PacketType::Doubles,
        14 => PacketType::Booleans,
        16 => PacketType::Reserved16,
        17 => PacketType::Hex,
        _ => return Err(Error::Protocol(format!("unknown packet type {value}"))),
    })
}

struct Cursor<'a> {
    bytes: &'a [u8],
    offset: usize,
}
impl<'a> Cursor<'a> {
    fn new(bytes: &'a [u8]) -> Self {
        Self { bytes, offset: 0 }
    }
    fn is_empty(&self) -> bool {
        self.offset == self.bytes.len()
    }
    fn take(&mut self, length: usize) -> Result<&'a [u8]> {
        let end = self
            .offset
            .checked_add(length)
            .ok_or_else(|| Error::Protocol("frame length overflow".into()))?;
        if end > self.bytes.len() {
            return Err(Error::Protocol("truncated schema table".into()));
        }
        let value = &self.bytes[self.offset..end];
        self.offset = end;
        Ok(value)
    }
    fn u8(&mut self) -> Result<u8> {
        Ok(self.take(1)?[0])
    }
    fn varint(&mut self) -> Result<u64> {
        let mut value = 0_u64;
        for shift in (0..=63).step_by(7) {
            let byte = self.u8()?;
            value |= u64::from(byte & 0x7f) << shift;
            if byte & 0x80 == 0 {
                return Ok(value);
            }
        }
        Err(Error::Protocol("variable integer is too long".into()))
    }
    fn varint_usize(&mut self) -> Result<usize> {
        usize::try_from(self.varint()?)
            .map_err(|_| Error::Protocol("length exceeds this platform".into()))
    }
    fn read_latin1(&mut self) -> Result<String> {
        let length = self.u8()? as usize;
        Ok(latin1(self.take(length)?))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::Packet;
    use sonic_ws_core::PacketType;

    #[test]
    fn registry_roundtrips_negotiated_metadata() {
        let packet = Packet::builder("movement.move", PacketType::VarInt)
            .data_range(3, 3)
            .schema(["dx", "dy", "dz"])
            .quantized(1000.0)
            .value_range(Some(-10.0), Some(10.0))
            .replay(true)
            .build()
            .unwrap();
        let registry = PacketRegistry::new([packet]).unwrap();
        let decoded = PacketRegistry::deserialize(&registry.serialize().unwrap()).unwrap();
        let packet = decoded.by_tag("movement.move").unwrap();
        assert_eq!(
            packet.fields.as_deref(),
            Some(["dx".into(), "dy".into(), "dz".into()].as_slice())
        );
        assert_eq!(packet.quantized.unwrap().scale, 1000.0);
        assert!(packet.replay);
    }

    #[test]
    fn registry_rejects_duplicate_tags_and_invalid_wire_types() {
        let first = Packet::builder("same", PacketType::None).build().unwrap();
        let second = Packet::builder("same", PacketType::None).build().unwrap();
        assert!(PacketRegistry::new([first, second]).is_err());
        assert!(PacketRegistry::deserialize(&[1, b'x', 0, 2, b'{', b'}', 0, 0, 0, 0, 15]).is_err());
    }
}
