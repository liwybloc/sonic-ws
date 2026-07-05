use sonic_ws::{
    EnumPackage, EnumValue, Packet, PacketRegistry, PacketType, SonicValue, VariantPermutation,
    packet_group, permutation_packet_group,
};

fn record(entries: &[(&str, SonicValue)]) -> SonicValue {
    SonicValue::Object(
        entries
            .iter()
            .map(|(key, value)| ((*key).into(), value.clone()))
            .collect(),
    )
}

#[test]
fn schema_objects_match_positional_wire_bytes() {
    let packet = Packet::builder("movement", PacketType::VarInt)
        .data_range(3, 3)
        .schema(["dx", "dy", "dz"])
        .build()
        .unwrap();
    let object = record(&[
        ("dx", SonicValue::I64(1)),
        ("dy", SonicValue::I64(-2)),
        ("dz", SonicValue::I64(3)),
    ]);
    let positional = SonicValue::Array(vec![
        SonicValue::I64(1),
        SonicValue::I64(-2),
        SonicValue::I64(3),
    ]);

    assert_eq!(
        packet.encode(&object, 1).unwrap(),
        packet.encode(&positional, 1).unwrap()
    );
    assert_eq!(
        packet.decode(&packet.encode(&object, 1).unwrap()).unwrap(),
        object
    );
}

#[test]
fn row_and_column_record_layouts_roundtrip() {
    let rows = SonicValue::Array(vec![
        record(&[
            ("id", SonicValue::I64(1)),
            ("name", SonicValue::String("one".into())),
        ]),
        record(&[
            ("id", SonicValue::I64(2)),
            ("name", SonicValue::String("two".into())),
        ]),
    ]);
    let row_packet = Packet::builder("rows", PacketType::VarInt)
        .data_range(0, 20)
        .schema(["x", "y"])
        .auto_flatten(true)
        .build()
        .unwrap();
    let numeric_rows = SonicValue::Array(vec![
        record(&[("x", SonicValue::I64(1)), ("y", SonicValue::I64(2))]),
        record(&[("x", SonicValue::I64(3)), ("y", SonicValue::I64(4))]),
    ]);
    assert_eq!(
        row_packet
            .decode(&row_packet.encode(&numeric_rows, 1).unwrap())
            .unwrap(),
        numeric_rows
    );

    let column_packet =
        Packet::object_builder("columns", [PacketType::VarInt, PacketType::StringsUtf16])
            .ranges(vec![0, 0], vec![10, 10])
            .schema(["id", "name"])
            .auto_transpose(true)
            .build()
            .unwrap();
    assert_eq!(
        column_packet
            .decode(&column_packet.encode(&rows, 1).unwrap())
            .unwrap(),
        rows
    );
}

#[test]
fn quantization_error_feedback_preserves_long_term_average() {
    let packet = Packet::builder("delta", PacketType::VarInt)
        .quantized(1024.0)
        .build()
        .unwrap();
    let input = SonicValue::F64(1.5283);
    let average = (0..2_000)
        .map(|_| {
            let decoded = packet.decode(&packet.encode(&input, 7).unwrap()).unwrap();
            let SonicValue::Array(values) = decoded else {
                panic!("array")
            };
            let SonicValue::F64(value) = values[0] else {
                panic!("float")
            };
            value
        })
        .sum::<f64>()
        / 2_000.0;

    assert!((average - 1.5283).abs() < 0.000_001);
}

#[test]
fn json_reserved_type_roundtrips_native_values() {
    let packet = Packet::builder("json", PacketType::Reserved16)
        .data_range(0, 10)
        .build()
        .unwrap();
    let value = record(&[
        ("name", SonicValue::String("SonicWS".into())),
        ("active", SonicValue::Bool(true)),
        ("count", SonicValue::I64(3)),
        (
            "items",
            SonicValue::Array(vec![SonicValue::Null, SonicValue::String("x".into())]),
        ),
    ]);
    let decoded = packet.decode(&packet.encode(&value, 1).unwrap()).unwrap();
    assert_eq!(decoded, SonicValue::Array(vec![value]));
}

#[test]
fn enums_groups_and_registry_metadata_roundtrip() {
    let colors = EnumPackage {
        name: "Color".into(),
        values: vec![
            EnumValue::String("red".into()),
            EnumValue::Null,
            EnumValue::Bool(true),
        ],
    };
    let enum_packet = Packet::builder("color", PacketType::Enums)
        .enum_data(colors)
        .build()
        .unwrap();
    let packets = packet_group("movement", [("color".into(), enum_packet)]).unwrap();
    let registry = PacketRegistry::new(packets).unwrap();
    let restored = PacketRegistry::deserialize(&registry.serialize().unwrap()).unwrap();

    assert_eq!(restored.len(), 2);
    assert!(
        restored
            .by_tag("movement")
            .unwrap()
            .group
            .as_ref()
            .unwrap()
            .is_parent
    );
    assert_eq!(
        restored
            .by_tag("movement.color")
            .unwrap()
            .group
            .as_ref()
            .unwrap()
            .variant,
        "color"
    );
}

#[test]
fn invalid_public_configurations_fail_early() {
    assert!(
        Packet::builder("bad", PacketType::VarInt)
            .data_range(3, 2)
            .build()
            .is_err()
    );
    assert!(
        Packet::builder("bad", PacketType::StringsUtf16)
            .quantized(10.0)
            .build()
            .is_err()
    );
    assert!(
        Packet::builder("bad", PacketType::VarInt)
            .auto_flatten(true)
            .build()
            .is_err()
    );
    assert!(
        PacketRegistry::new([
            Packet::builder("same", PacketType::None).build().unwrap(),
            Packet::builder("same", PacketType::None).build().unwrap(),
        ])
        .is_err()
    );
}

#[test]
fn none_raw_and_hex_scalar_modes_roundtrip_without_array_wrapping() {
    let none = Packet::builder("none", PacketType::None).build().unwrap();
    assert_eq!(
        none.decode(&none.encode(&SonicValue::Null, 1).unwrap())
            .unwrap(),
        SonicValue::Undefined
    );

    let raw = Packet::builder("raw", PacketType::Raw)
        .data_range(0, 1024)
        .build()
        .unwrap();
    let bytes = SonicValue::Bytes(vec![0, 1, 128, 255]);
    assert_eq!(raw.decode(&raw.encode(&bytes, 1).unwrap()).unwrap(), bytes);

    let hex = Packet::builder("hex", PacketType::Hex)
        .data_range(3, 3)
        .build()
        .unwrap();
    let value = SonicValue::String("00abff".into());
    assert_eq!(hex.decode(&hex.encode(&value, 1).unwrap()).unwrap(), value);
}

#[test]
fn variant_permutations_generate_resolve_and_survive_negotiation() {
    let permutation = VariantPermutation::wasd();
    assert_eq!(
        permutation.generate(),
        ["W", "A", "S", "D", "W,A", "W,D", "S,A", "S,D"]
    );
    assert_eq!(
        permutation
            .resolve_flags(&[true, true, false, false])
            .unwrap(),
        "W,A"
    );
    assert_eq!(
        permutation
            .resolve_flags(&[false, true, true, false])
            .unwrap(),
        "S,A"
    );
    assert!(
        permutation
            .resolve_flags(&[true, false, true, false])
            .is_err()
    );
    let packets = permutation_packet_group(
        "movement",
        &permutation,
        Packet::builder("template", PacketType::Shorts)
            .build()
            .unwrap(),
    )
    .unwrap();
    assert_eq!(
        packets
            .iter()
            .map(|packet| packet.definition.tag.as_str())
            .collect::<Vec<_>>(),
        [
            "movement",
            "movement.W",
            "movement.A",
            "movement.S",
            "movement.D",
            "movement.W,A",
            "movement.W,D",
            "movement.S,A",
            "movement.S,D",
        ]
    );
    let restored =
        PacketRegistry::deserialize(&PacketRegistry::new(packets).unwrap().serialize().unwrap())
            .unwrap();
    assert_eq!(
        restored
            .permutation_tag_flags("movement", &[true, true, false, false])
            .unwrap(),
        "movement.W,A"
    );
}
