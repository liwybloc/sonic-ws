use std::collections::HashMap;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use sonic_ws_core::{
    PacketDef, PacketSchema, PacketType, SchemaLimit, SchemaType, SonicValue,
    codec::{decode::decode_packet, encode::encode_packet, validate::validate_packet},
    enums::EnumPackage,
};

use crate::{Error, Result, json};

/// Packet-level numeric quantization settings.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Quantization {
    pub scale: f64,
    #[serde(default = "default_true")]
    pub track_error: bool,
}

const fn default_true() -> bool {
    true
}

fn deserialize_bool_or_null<'de, D: serde::Deserializer<'de>>(d: D) -> std::result::Result<bool, D::Error> {
    Ok(Option::<bool>::deserialize(d)?.unwrap_or(false))
}

/// Inclusive application-level numeric limits.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ValueRange {
    pub min: Option<f64>,
    pub max: Option<f64>,
}

/// Packet-group metadata negotiated with other runtimes.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Group {
    pub parent: String,
    pub variant: String,
    pub is_parent: bool,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Metadata {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub schema: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub quantized: Option<Quantization>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub min: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub group: Option<Group>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub constructor: Option<String>,
    #[serde(default, deserialize_with = "deserialize_bool_or_null", skip_serializing_if = "std::ops::Not::not")]
    pub replay: bool,
}

/// A negotiated packet definition plus high-level Rust mapping metadata.
#[derive(Debug)]
pub struct Packet {
    pub definition: PacketDef,
    pub fields: Option<Vec<String>>,
    pub quantized: Option<Quantization>,
    pub value_range: ValueRange,
    pub group: Option<Group>,
    pub constructor: Option<String>,
    pub replay: bool,
    pub rate_limit: u32,
    pub enabled: bool,
    quantization_error: Mutex<HashMap<u64, Vec<f64>>>,
}

impl Clone for Packet {
    fn clone(&self) -> Self {
        Self {
            definition: self.definition.clone(),
            fields: self.fields.clone(),
            quantized: self.quantized,
            value_range: self.value_range,
            group: self.group.clone(),
            constructor: self.constructor.clone(),
            replay: self.replay,
            rate_limit: self.rate_limit,
            enabled: self.enabled,
            quantization_error: Mutex::new(HashMap::new()),
        }
    }
}

impl Packet {
    /// Starts a homogeneous packet definition.
    pub fn builder(tag: impl Into<String>, packet_type: PacketType) -> PacketBuilder {
        PacketBuilder::new(tag, packet_type)
    }

    /// Starts a heterogeneous object-packet definition.
    pub fn object_builder(
        tag: impl Into<String>,
        packet_types: impl IntoIterator<Item = PacketType>,
    ) -> ObjectPacketBuilder {
        ObjectPacketBuilder::new(tag, packet_types.into_iter().collect())
    }

    pub(crate) fn from_parts(definition: PacketDef, metadata: Metadata) -> Self {
        Self {
            definition,
            fields: metadata.schema,
            quantized: metadata.quantized,
            value_range: ValueRange {
                min: metadata.min,
                max: metadata.max,
            },
            group: metadata.group,
            constructor: metadata.constructor,
            replay: metadata.replay,
            rate_limit: 0,
            enabled: true,
            quantization_error: Mutex::new(HashMap::new()),
        }
    }

    /// Encodes one application value with schema mapping and quantization.
    pub fn encode(&self, value: &SonicValue, connection_id: u64) -> Result<Vec<u8>> {
        let prepared = self.prepare_send(value, connection_id)?;
        validate_logical_count(self, &prepared)?;
        Ok(encode_packet(&self.definition, &prepared)?)
    }

    /// Validates and decodes one wire payload into an application value.
    pub fn decode(&self, bytes: &[u8]) -> Result<SonicValue> {
        validate_packet(&self.definition, bytes)?;
        let decoded = decode_packet(&self.definition, bytes)?;
        self.finish_receive(decoded)
    }

    pub(crate) fn metadata(&self) -> Metadata {
        Metadata {
            schema: self.fields.clone(),
            quantized: self.quantized,
            min: self.value_range.min,
            max: self.value_range.max,
            group: self.group.clone(),
            constructor: self.constructor.clone(),
            replay: self.replay,
        }
    }

    fn prepare_send(&self, value: &SonicValue, connection_id: u64) -> Result<SonicValue> {
        if self.definition.schema.object {
            return self.prepare_object(value, connection_id);
        }
        if matches!(
            self.definition.schema.packet_type,
            SchemaType::Single(PacketType::None)
        ) {
            return Ok(value.clone());
        }
        if matches!(
            self.definition.schema.packet_type,
            SchemaType::Single(PacketType::Raw | PacketType::Hex)
        ) {
            return Ok(value.clone());
        }

        let mut flat = if self.definition.schema.auto_flatten {
            let records = array(value, "autoFlatten expects an array of records")?;
            let fields = self.fields.as_ref().ok_or_else(|| {
                Error::Schema(format!(
                    "packet \"{}\" autoFlatten requires schema",
                    self.definition.tag
                ))
            })?;
            let mut values = Vec::with_capacity(records.len() * fields.len());
            for record in records {
                values.extend(extract_record(record, fields, &self.definition.tag)?);
            }
            values
        } else if let (Some(fields), SonicValue::Object(_)) = (&self.fields, value) {
            extract_record(value, fields, &self.definition.tag)?
        } else {
            match value {
                SonicValue::Array(values) => values.clone(),
                value => vec![value.clone()],
            }
        };

        self.transform_numbers(&mut flat, true, connection_id)?;
        let value = SonicValue::Array(flat);
        if matches!(
            self.definition.schema.packet_type,
            SchemaType::Single(PacketType::Reserved16)
        ) {
            return Ok(SonicValue::Bytes(json::encode_sonic(&value)?));
        }
        Ok(value)
    }

    fn prepare_object(&self, value: &SonicValue, _connection_id: u64) -> Result<SonicValue> {
        if self.definition.schema.auto_flatten {
            let fields = self.fields.as_ref().ok_or_else(|| {
                Error::Schema(format!(
                    "packet \"{}\" autoTranspose requires schema",
                    self.definition.tag
                ))
            })?;
            let records = array(value, "autoTranspose expects an array of records")?;
            let rows = records
                .iter()
                .map(|record| extract_record(record, fields, &self.definition.tag))
                .collect::<Result<Vec<_>>>()?;
            let columns = (0..fields.len())
                .map(|column| {
                    SonicValue::Array(rows.iter().map(|row| row[column].clone()).collect())
                })
                .collect();
            return self.prepare_object_json_columns(columns);
        }

        if let (Some(fields), SonicValue::Object(_)) = (&self.fields, value) {
            return self.prepare_object_json_columns(extract_record(
                value,
                fields,
                &self.definition.tag,
            )?);
        }
        let SonicValue::Array(values) = value else {
            return Ok(value.clone());
        };
        self.prepare_object_json_columns(values.clone())
    }

    fn prepare_object_json_columns(&self, mut values: Vec<SonicValue>) -> Result<SonicValue> {
        let SchemaType::Object(types) = &self.definition.schema.packet_type else {
            return Ok(SonicValue::Array(values));
        };
        for (kind, value) in types.iter().zip(&mut values) {
            if *kind == PacketType::Reserved16 {
                *value = SonicValue::Bytes(json::encode_sonic(value)?);
            }
        }
        Ok(SonicValue::Array(values))
    }

    fn finish_receive(&self, value: SonicValue) -> Result<SonicValue> {
        let value = self.decode_json_values(value)?;
        if matches!(
            self.definition.schema.packet_type,
            SchemaType::Single(PacketType::None | PacketType::Raw | PacketType::Hex)
        ) {
            return Ok(value);
        }
        if self.definition.schema.object && self.definition.schema.auto_flatten {
            let fields = self
                .fields
                .as_ref()
                .ok_or_else(|| Error::Schema("autoTranspose requires schema".into()))?;
            let columns = array(&value, "object packet did not decode to columns")?;
            if columns.len() != fields.len() {
                return Err(Error::Value(
                    "object column count does not match schema".into(),
                ));
            }
            let columns = columns
                .iter()
                .map(|column| array(column, "object column is not an array"))
                .collect::<Result<Vec<_>>>()?;
            let count = columns.first().map_or(0, |column| column.len());
            if columns.iter().any(|column| column.len() != count) {
                return Err(Error::Value(
                    "autoTranspose columns have different lengths".into(),
                ));
            }
            return Ok(SonicValue::Array(
                (0..count)
                    .map(|row| {
                        SonicValue::Object(
                            fields
                                .iter()
                                .enumerate()
                                .map(|(column, field)| {
                                    (field.clone(), columns[column][row].clone())
                                })
                                .collect(),
                        )
                    })
                    .collect(),
            ));
        }

        let mut values = match value {
            SonicValue::Array(values) => values,
            value => vec![value],
        };
        self.transform_numbers(&mut values, false, 0)?;

        if self.definition.schema.auto_flatten {
            let fields = self
                .fields
                .as_ref()
                .ok_or_else(|| Error::Schema("autoFlatten requires schema".into()))?;
            if values.len() % fields.len() != 0 {
                return Err(Error::Value(format!(
                    "flat value count {} is not divisible by schema length {}",
                    values.len(),
                    fields.len()
                )));
            }
            return Ok(SonicValue::Array(
                values
                    .chunks(fields.len())
                    .map(|row| {
                        SonicValue::Object(
                            fields.iter().cloned().zip(row.iter().cloned()).collect(),
                        )
                    })
                    .collect(),
            ));
        }

        if let Some(fields) = &self.fields {
            if values.len() != fields.len() {
                return Err(Error::Value(
                    "decoded value count does not match schema".into(),
                ));
            }
            return Ok(SonicValue::Object(
                fields.iter().cloned().zip(values).collect(),
            ));
        }
        Ok(SonicValue::Array(values))
    }

    fn decode_json_values(&self, value: SonicValue) -> Result<SonicValue> {
        match &self.definition.schema.packet_type {
            SchemaType::Single(PacketType::Reserved16) => {
                let SonicValue::Bytes(bytes) = value else {
                    return Err(Error::Value("JSON packet did not decode to bytes".into()));
                };
                json::decode_sonic(&bytes)
            }
            SchemaType::Object(types) => {
                let SonicValue::Array(mut values) = value else {
                    return Err(Error::Value(
                        "object packet did not decode to fields".into(),
                    ));
                };
                for (kind, value) in types.iter().zip(&mut values) {
                    if *kind == PacketType::Reserved16 {
                        let SonicValue::Bytes(bytes) = value else {
                            return Err(Error::Value(
                                "JSON object field did not decode to bytes".into(),
                            ));
                        };
                        *value = json::decode_sonic(bytes)?;
                    }
                }
                Ok(SonicValue::Array(values))
            }
            _ => Ok(value),
        }
    }

    fn transform_numbers(
        &self,
        values: &mut [SonicValue],
        sending: bool,
        connection_id: u64,
    ) -> Result<()> {
        if self.quantized.is_none()
            && self.value_range.min.is_none()
            && self.value_range.max.is_none()
        {
            return Ok(());
        }
        let mut states = self
            .quantization_error
            .lock()
            .expect("quantization state poisoned");
        let errors = states
            .entry(connection_id)
            .or_insert_with(|| vec![0.0; values.len()]);
        if errors.len() < values.len() {
            errors.resize(values.len(), 0.0);
        }

        for (index, value) in values.iter_mut().enumerate() {
            let number = number(value).ok_or_else(|| {
                Error::Value(format!(
                    "packet \"{}\" requires finite numeric values",
                    self.definition.tag
                ))
            })?;
            let logical = if sending {
                number
            } else {
                number / self.quantized.map_or(1.0, |q| q.scale)
            };
            if !logical.is_finite() {
                return Err(Error::Value("numeric value must be finite".into()));
            }
            if self.value_range.min.is_some_and(|min| logical < min)
                || self.value_range.max.is_some_and(|max| logical > max)
            {
                return Err(Error::Value(format!(
                    "packet \"{}\" value {logical} is outside its configured range",
                    self.definition.tag
                )));
            }
            if let Some(quantized) = self.quantized {
                if sending {
                    let scaled = logical * quantized.scale
                        + if quantized.track_error {
                            errors[index]
                        } else {
                            0.0
                        };
                    let rounded = scaled.round();
                    if quantized.track_error {
                        errors[index] = scaled - rounded;
                    }
                    *value = SonicValue::I64(rounded as i64);
                } else {
                    *value = SonicValue::F64(logical);
                }
            }
        }
        Ok(())
    }
}

/// Builds a NONE parent followed by ordinary group variants.
pub fn packet_group(
    tag: impl Into<String>,
    variants: impl IntoIterator<Item = (String, Packet)>,
) -> Result<Vec<Packet>> {
    let tag = tag.into();
    let parent = Packet::builder(tag.clone(), PacketType::None)
        .group(Group {
            parent: tag.clone(),
            variant: String::new(),
            is_parent: true,
        })
        .build()?;
    let mut packets = vec![parent];
    for (variant, mut packet) in variants {
        packet.definition.tag = format!("{tag}.{variant}");
        packet.group = Some(Group {
            parent: tag.clone(),
            variant,
            is_parent: false,
        });
        packets.push(packet);
    }
    Ok(packets)
}

/// Builder for homogeneous packet definitions.
#[derive(Debug, Clone)]
pub struct PacketBuilder {
    tag: String,
    kind: PacketType,
    data_min: u64,
    data_max: u64,
    fields: Option<Vec<String>>,
    quantized: Option<Quantization>,
    range: ValueRange,
    auto_flatten: bool,
    dont_spread: bool,
    rereference: bool,
    compression: bool,
    batching_ms: i32,
    max_batch_size: i32,
    group: Option<Group>,
    replay: bool,
    rate_limit: u32,
    enabled: bool,
    enum_data: Vec<EnumPackage>,
}

impl PacketBuilder {
    fn new(tag: impl Into<String>, kind: PacketType) -> Self {
        let min = if kind == PacketType::None { 0 } else { 1 };
        Self {
            tag: tag.into(),
            kind,
            data_min: min,
            data_max: min,
            fields: None,
            quantized: None,
            range: ValueRange {
                min: None,
                max: None,
            },
            auto_flatten: false,
            dont_spread: false,
            rereference: false,
            compression: kind == PacketType::Reserved16,
            batching_ms: 0,
            max_batch_size: 10,
            group: None,
            replay: false,
            rate_limit: 0,
            enabled: true,
            enum_data: vec![],
        }
    }
    pub fn data_range(mut self, min: u64, max: u64) -> Self {
        self.data_min = min;
        self.data_max = max;
        self
    }
    pub fn schema(mut self, fields: impl IntoIterator<Item = impl Into<String>>) -> Self {
        self.fields = Some(fields.into_iter().map(Into::into).collect());
        self
    }
    pub fn auto_flatten(mut self, enabled: bool) -> Self {
        self.auto_flatten = enabled;
        self
    }
    pub fn quantized(mut self, scale: f64) -> Self {
        self.quantized = Some(Quantization {
            scale,
            track_error: true,
        });
        self
    }
    pub fn quantization(mut self, settings: Quantization) -> Self {
        self.quantized = Some(settings);
        self
    }
    pub fn value_range(mut self, min: Option<f64>, max: Option<f64>) -> Self {
        self.range = ValueRange { min, max };
        self
    }
    pub fn compression(mut self, enabled: bool) -> Self {
        self.compression = enabled;
        self
    }
    pub fn batching(mut self, milliseconds: i32, max_size: i32) -> Self {
        self.batching_ms = milliseconds;
        self.max_batch_size = max_size;
        self
    }
    pub fn dont_spread(mut self, enabled: bool) -> Self {
        self.dont_spread = enabled;
        self
    }
    pub fn rereference(mut self, enabled: bool) -> Self {
        self.rereference = enabled;
        self
    }
    pub fn replay(mut self, enabled: bool) -> Self {
        self.replay = enabled;
        self
    }
    pub fn rate_limit(mut self, packets_per_second: u32) -> Self {
        self.rate_limit = packets_per_second;
        self
    }
    pub fn enabled(mut self, enabled: bool) -> Self {
        self.enabled = enabled;
        self
    }
    pub fn group(mut self, group: Group) -> Self {
        self.group = Some(group);
        self
    }
    pub fn enum_data(mut self, package: EnumPackage) -> Self {
        self.enum_data.push(package);
        self
    }

    pub fn build(self) -> Result<Packet> {
        if self.tag.is_empty()
            || self.tag.chars().any(|character| u32::from(character) > 255)
            || self.tag.len() > 255
        {
            return Err(Error::Schema(
                "packet tags must contain 1-255 Latin-1 characters".into(),
            ));
        }
        if self.data_min > self.data_max {
            return Err(Error::Schema("data minimum exceeds maximum".into()));
        }
        if self.rereference && self.data_min == 0 {
            return Err(Error::Schema(
                "rereference requires a nonzero minimum".into(),
            ));
        }
        if self.replay && self.batching_ms != 0 {
            return Err(Error::Schema(
                "replay cannot be combined with batching".into(),
            ));
        }
        if let Some(fields) = &self.fields {
            if fields.is_empty() || fields.iter().any(String::is_empty) {
                return Err(Error::Schema("schema fields cannot be empty".into()));
            }
            if !self.auto_flatten
                && self.data_min == self.data_max
                && fields.len() as u64 != self.data_max
            {
                return Err(Error::Schema(format!(
                    "schema length must match fixed value count ({})",
                    self.data_max
                )));
            }
        } else if self.auto_flatten {
            return Err(Error::Schema("autoFlatten requires schema".into()));
        }
        if let Some(q) = self.quantized
            && (!q.scale.is_finite() || q.scale <= 0.0 || !numeric_type(self.kind))
        {
            return Err(Error::Schema(
                "quantization requires a positive scale and numeric packet type".into(),
            ));
        }
        if self
            .range
            .min
            .zip(self.range.max)
            .is_some_and(|(min, max)| min > max)
        {
            return Err(Error::Schema("value minimum exceeds maximum".into()));
        }
        Ok(Packet {
            definition: PacketDef {
                tag: self.tag,
                schema: PacketSchema {
                    object: false,
                    packet_type: SchemaType::Single(self.kind),
                    data_min: SchemaLimit::Single(self.data_min),
                    data_max: SchemaLimit::Single(self.data_max),
                    data_batching: self.batching_ms,
                    max_batch_size: self.max_batch_size,
                    dont_spread: self.dont_spread,
                    auto_flatten: self.auto_flatten,
                    rereference: self.rereference,
                    gzip_compression: self.compression,
                },
                enum_data: self.enum_data,
            },
            fields: self.fields,
            quantized: self.quantized,
            value_range: self.range,
            group: self.group,
            constructor: None,
            replay: self.replay,
            rate_limit: self.rate_limit,
            enabled: self.enabled,
            quantization_error: Mutex::new(HashMap::new()),
        })
    }
}

/// Builder for heterogeneous column-framed object packets.
#[derive(Debug, Clone)]
pub struct ObjectPacketBuilder {
    tag: String,
    types: Vec<PacketType>,
    minimums: Vec<u64>,
    maximums: Vec<u64>,
    fields: Option<Vec<String>>,
    auto_transpose: bool,
    dont_spread: bool,
    batching_ms: i32,
    max_batch_size: i32,
    enum_data: Vec<EnumPackage>,
}

impl ObjectPacketBuilder {
    fn new(tag: impl Into<String>, types: Vec<PacketType>) -> Self {
        let length = types.len();
        Self {
            tag: tag.into(),
            types,
            minimums: vec![1; length],
            maximums: vec![1; length],
            fields: None,
            auto_transpose: false,
            dont_spread: false,
            batching_ms: 0,
            max_batch_size: 10,
            enum_data: vec![],
        }
    }
    pub fn ranges(mut self, minimums: Vec<u64>, maximums: Vec<u64>) -> Self {
        self.minimums = minimums;
        self.maximums = maximums;
        self
    }
    pub fn schema(mut self, fields: impl IntoIterator<Item = impl Into<String>>) -> Self {
        self.fields = Some(fields.into_iter().map(Into::into).collect());
        self
    }
    pub fn auto_transpose(mut self, enabled: bool) -> Self {
        self.auto_transpose = enabled;
        self
    }
    pub fn dont_spread(mut self, enabled: bool) -> Self {
        self.dont_spread = enabled;
        self
    }
    pub fn batching(mut self, milliseconds: i32, max_size: i32) -> Self {
        self.batching_ms = milliseconds;
        self.max_batch_size = max_size;
        self
    }
    pub fn enum_data(mut self, package: EnumPackage) -> Self {
        self.enum_data.push(package);
        self
    }

    pub fn build(self) -> Result<Packet> {
        if self.types.is_empty() || self.types.len() > 255 {
            return Err(Error::Schema("object packets require 1-255 fields".into()));
        }
        if self.minimums.len() != self.types.len() || self.maximums.len() != self.types.len() {
            return Err(Error::Schema(
                "object range count must match type count".into(),
            ));
        }
        if self
            .minimums
            .iter()
            .zip(&self.maximums)
            .any(|(min, max)| min > max)
        {
            return Err(Error::Schema("object data minimum exceeds maximum".into()));
        }
        if let Some(fields) = &self.fields
            && fields.len() != self.types.len()
        {
            return Err(Error::Schema(
                "object schema length must match type count".into(),
            ));
        }
        if self.auto_transpose && self.fields.is_none() {
            return Err(Error::Schema("autoTranspose requires schema".into()));
        }
        let enum_fields = self
            .types
            .iter()
            .filter(|kind| **kind == PacketType::Enums)
            .count();
        if enum_fields != self.enum_data.len() {
            return Err(Error::Schema(
                "object enum package count does not match enum fields".into(),
            ));
        }
        let metadata = Metadata {
            schema: self.fields,
            ..Metadata::default()
        };
        Ok(Packet::from_parts(
            PacketDef {
                tag: self.tag,
                schema: PacketSchema {
                    object: true,
                    packet_type: SchemaType::Object(self.types),
                    data_min: SchemaLimit::Object(self.minimums),
                    data_max: SchemaLimit::Object(self.maximums),
                    data_batching: self.batching_ms,
                    max_batch_size: self.max_batch_size,
                    dont_spread: self.dont_spread,
                    auto_flatten: self.auto_transpose,
                    rereference: false,
                    gzip_compression: false,
                },
                enum_data: self.enum_data,
            },
            metadata,
        ))
    }
}

fn numeric_type(kind: PacketType) -> bool {
    matches!(
        kind,
        PacketType::Bytes
            | PacketType::UBytes
            | PacketType::Shorts
            | PacketType::UShorts
            | PacketType::VarInt
            | PacketType::UVarInt
            | PacketType::Deltas
            | PacketType::Floats
            | PacketType::Doubles
    )
}
fn number(value: &SonicValue) -> Option<f64> {
    match value {
        SonicValue::I64(v) => Some(*v as f64),
        SonicValue::U64(v) => Some(*v as f64),
        SonicValue::F32(v) => Some(f64::from(*v)),
        SonicValue::F64(v) => Some(*v),
        _ => None,
    }
}
fn array<'a>(value: &'a SonicValue, error: &str) -> Result<&'a [SonicValue]> {
    if let SonicValue::Array(values) = value {
        Ok(values)
    } else {
        Err(Error::Value(error.into()))
    }
}
fn extract_record(value: &SonicValue, fields: &[String], tag: &str) -> Result<Vec<SonicValue>> {
    let SonicValue::Object(entries) = value else {
        return Err(Error::Value(format!(
            "packet \"{tag}\" requires an object record"
        )));
    };
    let values: HashMap<&str, &SonicValue> = entries
        .iter()
        .map(|(key, value)| (key.as_str(), value))
        .collect();
    let unknown: Vec<_> = values
        .keys()
        .filter(|key| !fields.iter().any(|field| field == **key))
        .collect();
    if !unknown.is_empty() {
        return Err(Error::Value(format!(
            "packet \"{tag}\" has unknown schema fields"
        )));
    }
    fields
        .iter()
        .map(|field| {
            values.get(field.as_str()).cloned().cloned().ok_or_else(|| {
                Error::Value(format!(
                    "packet \"{tag}\" is missing schema field \"{field}\""
                ))
            })
        })
        .collect()
}
fn validate_logical_count(packet: &Packet, value: &SonicValue) -> Result<()> {
    if packet.definition.schema.object {
        return Ok(());
    }
    let count = match (&packet.definition.schema.packet_type, value) {
        (SchemaType::Single(PacketType::Raw), SonicValue::Bytes(values)) => values.len() as u64,
        (SchemaType::Single(PacketType::Hex), SonicValue::String(value)) => {
            value.len().div_ceil(2) as u64
        }
        (_, SonicValue::Array(values)) => values.len() as u64,
        (_, SonicValue::Null | SonicValue::Undefined)
            if matches!(
                packet.definition.schema.packet_type,
                SchemaType::Single(PacketType::None)
            ) =>
        {
            0
        }
        _ => 1,
    };
    if let (SchemaLimit::Single(min), SchemaLimit::Single(max)) = (
        &packet.definition.schema.data_min,
        &packet.definition.schema.data_max,
    ) && (count < *min || count > *max)
    {
        return Err(Error::Value(format!(
            "packet value count {count} is outside {min}..={max}"
        )));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn object(entries: &[(&str, i64)]) -> SonicValue {
        SonicValue::Object(
            entries
                .iter()
                .map(|(key, value)| ((*key).into(), SonicValue::F64(*value as f64)))
                .collect(),
        )
    }

    #[test]
    fn schema_mapping_matches_positional_encoding() {
        let packet = Packet::builder("move", PacketType::VarInt)
            .data_range(3, 3)
            .schema(["x", "y", "z"])
            .build()
            .unwrap();
        let mapped = packet.encode(&object(&[("x", 1), ("y", -2), ("z", 3)]), 1);
        assert!(mapped.is_err(), "unquantized integer packets reject floats");
        let record = SonicValue::Object(vec![
            ("x".into(), SonicValue::I64(1)),
            ("y".into(), SonicValue::I64(-2)),
            ("z".into(), SonicValue::I64(3)),
        ]);
        assert_eq!(
            packet.encode(&record, 1).unwrap(),
            packet
                .encode(
                    &SonicValue::Array(vec![
                        SonicValue::I64(1),
                        SonicValue::I64(-2),
                        SonicValue::I64(3)
                    ]),
                    1
                )
                .unwrap()
        );
        assert_eq!(
            packet.decode(&packet.encode(&record, 1).unwrap()).unwrap(),
            record
        );
    }

    #[test]
    fn schema_mapping_rejects_missing_and_extra_fields() {
        let packet = Packet::builder("move", PacketType::VarInt)
            .data_range(2, 2)
            .schema(["x", "y"])
            .build()
            .unwrap();
        assert!(
            packet
                .encode(
                    &SonicValue::Object(vec![("x".into(), SonicValue::I64(1))]),
                    1
                )
                .is_err()
        );
        assert!(
            packet
                .encode(
                    &SonicValue::Object(vec![
                        ("x".into(), SonicValue::I64(1)),
                        ("y".into(), SonicValue::I64(2)),
                        ("z".into(), SonicValue::I64(3))
                    ]),
                    1
                )
                .is_err()
        );
    }

    #[test]
    fn row_major_auto_flatten_roundtrips() {
        let packet = Packet::builder("rows", PacketType::VarInt)
            .data_range(0, 100)
            .schema(["x", "y"])
            .auto_flatten(true)
            .build()
            .unwrap();
        let rows = SonicValue::Array(vec![
            SonicValue::Object(vec![
                ("x".into(), SonicValue::I64(1)),
                ("y".into(), SonicValue::I64(2)),
            ]),
            SonicValue::Object(vec![
                ("x".into(), SonicValue::I64(3)),
                ("y".into(), SonicValue::I64(4)),
            ]),
        ]);
        assert_eq!(
            packet.decode(&packet.encode(&rows, 1).unwrap()).unwrap(),
            rows
        );
    }

    #[test]
    fn column_major_auto_transpose_roundtrips() {
        let packet =
            Packet::object_builder("objects", [PacketType::VarInt, PacketType::StringsUtf16])
                .ranges(vec![0, 0], vec![10, 10])
                .schema(["x", "name"])
                .auto_transpose(true)
                .build()
                .unwrap();
        let rows = SonicValue::Array(vec![
            SonicValue::Object(vec![
                ("x".into(), SonicValue::I64(1)),
                ("name".into(), SonicValue::String("one".into())),
            ]),
            SonicValue::Object(vec![
                ("x".into(), SonicValue::I64(2)),
                ("name".into(), SonicValue::String("two".into())),
            ]),
        ]);
        assert_eq!(
            packet.decode(&packet.encode(&rows, 1).unwrap()).unwrap(),
            rows
        );
    }

    #[test]
    fn quantization_tracks_error_per_field_and_connection() {
        let packet = Packet::builder("movement", PacketType::VarInt)
            .data_range(1, 1)
            .quantized(1024.0)
            .build()
            .unwrap();
        let input = SonicValue::F64(1.5283);
        let average = (0..1000)
            .map(|_| {
                let SonicValue::Array(values) =
                    packet.decode(&packet.encode(&input, 7).unwrap()).unwrap()
                else {
                    unreachable!()
                };
                let SonicValue::F64(value) = values[0] else {
                    unreachable!()
                };
                value
            })
            .sum::<f64>()
            / 1000.0;
        assert!(
            (average - 1.5283).abs() < 0.000_001,
            "error feedback keeps the long-term average synchronized"
        );
        assert_eq!(
            packet.encode(&input, 8).unwrap(),
            packet.encode(&input, 9).unwrap(),
            "connections have independent residuals"
        );
    }

    #[test]
    fn packet_group_contains_parent_and_qualified_children() {
        let children = packet_group(
            "movement",
            [(
                "move".into(),
                Packet::builder("ignored", PacketType::VarInt)
                    .build()
                    .unwrap(),
            )],
        )
        .unwrap();
        assert_eq!(
            children
                .iter()
                .map(|packet| packet.definition.tag.as_str())
                .collect::<Vec<_>>(),
            ["movement", "movement.move"]
        );
        assert!(children[0].group.as_ref().unwrap().is_parent);
    }
}
