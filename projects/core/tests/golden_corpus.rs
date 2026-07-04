use sonic_ws_core::{
    PacketDef, PacketSchema, PacketType, SchemaLimit, SchemaType, SonicValue,
    codec::{decode::decode_packet, encode::encode_packet},
};

fn packet(kind: PacketType, count: usize) -> PacketDef {
    PacketDef { tag: "golden".into(), schema: PacketSchema {
        object: false, packet_type: SchemaType::Single(kind),
        data_min: SchemaLimit::Single(count as u64), data_max: SchemaLimit::Single(count as u64),
        data_batching: 0, max_batch_size: 0, dont_spread: false, auto_flatten: false,
        rereference: false, gzip_compression: false,
    }, enum_data: vec![] }
}

fn field<'a>(line: &'a str, prefix: &str, suffix: &str) -> &'a str {
    line.split_once(prefix).unwrap().1.split_once(suffix).unwrap().0
}
fn kind(name: &str) -> PacketType { match name {
    "BYTES" => PacketType::Bytes, "UBYTES" => PacketType::UBytes,
    "SHORTS" => PacketType::Shorts, "USHORTS" => PacketType::UShorts,
    "VARINT" => PacketType::VarInt, "UVARINT" => PacketType::UVarInt,
    "DELTAS" => PacketType::Deltas, "STRINGS_ASCII" => PacketType::StringsAscii,
    "STRINGS_UTF16" => PacketType::StringsUtf16, "BOOLEANS" => PacketType::Booleans,
    "HEX" => PacketType::Hex, other => panic!("unsupported golden type {other}"),
} }
fn bytes(hex: &str) -> Vec<u8> { hex.as_bytes().chunks_exact(2).map(|pair|
    u8::from_str_radix(std::str::from_utf8(pair).unwrap(), 16).unwrap()).collect() }

#[test]
fn shared_golden_vectors_encode_and_decode() {
    let corpus = include_str!("../../../protocol/golden-vectors.json");
    assert!(corpus.contains("\"protocolVersion\": 24"));
    for line in corpus.lines().filter(|line| line.contains("{ \"name\":") && !line.contains("\"schema\"")) {
        let name = field(line, "\"name\": \"", "\"");
        let kind = kind(field(line, "\"type\": \"", "\""));
        let raw_values = field(line, "\"values\": [", "], \"hex\"");
        let parts: Vec<&str> = if raw_values.is_empty() { vec![] } else { raw_values.split(", ").collect() };
        let value = if kind == PacketType::Hex {
            SonicValue::String(parts[0].trim_matches('"').into())
        } else {
            SonicValue::Array(parts.iter().map(|raw| match kind {
                PacketType::StringsAscii | PacketType::StringsUtf16 => SonicValue::String(raw.trim_matches('"').into()),
                PacketType::Booleans => SonicValue::Bool(*raw == "true"),
                PacketType::UBytes | PacketType::UShorts | PacketType::UVarInt => SonicValue::U64(raw.parse().unwrap()),
                _ => SonicValue::I64(raw.parse().unwrap()),
            }).collect())
        };
        let expected = bytes(field(line, "\"hex\": \"", "\""));
        let count = if kind == PacketType::Hex { expected.len() } else { parts.len() };
        let definition = packet(kind, count);
        assert_eq!(encode_packet(&definition, &value).unwrap(), expected, "{name}");
        assert_eq!(decode_packet(&definition, &expected).unwrap(), value, "{name}");
    }
}
