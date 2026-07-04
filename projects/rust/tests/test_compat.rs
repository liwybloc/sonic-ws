//! Cross-runtime wire compatibility coverage for the public Rust transport.
//!
//! TypeScript and Python use the same tags, values, enum ordering, and protocol
//! version in their `test_compat` suites. This test exercises both Rust wire
//! directions over a real WebSocket rather than only calling codec functions.

use sonic_ws::{
    Client, EnumPackage, EnumValue, Incoming, Packet, PacketRegistry, PacketType, Server,
    ServerConfig, SonicValue,
};

fn array(values: impl IntoIterator<Item = SonicValue>) -> SonicValue {
    SonicValue::Array(values.into_iter().collect())
}

fn signed(values: &[i64]) -> SonicValue {
    array(values.iter().copied().map(SonicValue::I64))
}

fn unsigned(values: &[u64]) -> SonicValue {
    array(values.iter().copied().map(SonicValue::U64))
}

fn strings(values: &[&str]) -> SonicValue {
    array(
        values
            .iter()
            .map(|value| SonicValue::String((*value).into())),
    )
}

fn assert_compatible(actual: &SonicValue, expected: &SonicValue) {
    match (actual, expected) {
        (SonicValue::F64(actual), SonicValue::F64(expected))
            if actual.is_finite() && expected.is_finite() =>
        {
            let tolerance = expected.abs().max(1.0) * f64::EPSILON * 4.0;
            assert!(
                (actual - expected).abs() <= tolerance,
                "{actual} != {expected}"
            );
        }
        (SonicValue::Array(actual), SonicValue::Array(expected)) => {
            assert_eq!(actual.len(), expected.len());
            for (actual, expected) in actual.iter().zip(expected) {
                assert_compatible(actual, expected);
            }
        }
        (SonicValue::Object(actual), SonicValue::Object(expected)) => {
            assert_eq!(actual.len(), expected.len());
            for ((actual_key, actual), (expected_key, expected)) in actual.iter().zip(expected) {
                assert_eq!(actual_key, expected_key);
                assert_compatible(actual, expected);
            }
        }
        _ => assert_eq!(actual, expected),
    }
}

fn mixed_enum() -> EnumPackage {
    EnumPackage {
        name: "compat-mixed".into(),
        values: vec![
            EnumValue::String("alpha".into()),
            EnumValue::Number(7.0),
            EnumValue::Bool(true),
            EnumValue::Null,
        ],
    }
}

fn packet_definitions() -> Vec<Packet> {
    vec![
        Packet::builder("none", PacketType::None).build().unwrap(),
        Packet::builder("raw", PacketType::Raw)
            .data_range(4, 4)
            .build()
            .unwrap(),
        Packet::builder("ascii", PacketType::StringsAscii)
            .data_range(3, 3)
            .build()
            .unwrap(),
        Packet::builder("utf16", PacketType::StringsUtf16)
            .data_range(4, 4)
            .build()
            .unwrap(),
        Packet::builder("enums", PacketType::Enums)
            .data_range(4, 4)
            .enum_data(mixed_enum())
            .build()
            .unwrap(),
        Packet::builder("bytes", PacketType::Bytes)
            .data_range(5, 5)
            .build()
            .unwrap(),
        Packet::builder("ubytes", PacketType::UBytes)
            .data_range(4, 4)
            .build()
            .unwrap(),
        Packet::builder("shorts", PacketType::Shorts)
            .data_range(5, 5)
            .build()
            .unwrap(),
        Packet::builder("ushorts", PacketType::UShorts)
            .data_range(4, 4)
            .build()
            .unwrap(),
        Packet::builder("varint", PacketType::VarInt)
            .data_range(5, 5)
            .build()
            .unwrap(),
        Packet::builder("uvarint", PacketType::UVarInt)
            .data_range(7, 7)
            .build()
            .unwrap(),
        Packet::builder("deltas", PacketType::Deltas)
            .data_range(8, 8)
            .build()
            .unwrap(),
        Packet::builder("floats", PacketType::Floats)
            .data_range(5, 5)
            .build()
            .unwrap(),
        Packet::builder("doubles", PacketType::Doubles)
            .data_range(5, 5)
            .build()
            .unwrap(),
        Packet::builder("booleans", PacketType::Booleans)
            .data_range(9, 9)
            .build()
            .unwrap(),
        Packet::builder("json", PacketType::Reserved16)
            .data_range(0, 10)
            .build()
            .unwrap(),
        Packet::builder("hex", PacketType::Hex)
            .data_range(3, 3)
            .build()
            .unwrap(),
        Packet::object_builder(
            "object",
            [
                PacketType::StringsUtf16,
                PacketType::Booleans,
                PacketType::VarInt,
            ],
        )
        .ranges(vec![2, 3, 3], vec![2, 3, 3])
        .build()
        .unwrap(),
        Packet::builder("compressed", PacketType::StringsUtf16)
            .data_range(2, 2)
            .compression(true)
            .build()
            .unwrap(),
        Packet::builder("batch", PacketType::UVarInt)
            .data_range(1, 1)
            .batching(1, 10)
            .build()
            .unwrap(),
    ]
}

fn cases() -> Vec<(&'static str, SonicValue, SonicValue)> {
    let json = SonicValue::Object(vec![
        ("message".into(), SonicValue::String("compat".into())),
        ("count".into(), SonicValue::I64(3)),
        ("ok".into(), SonicValue::Bool(true)),
    ]);
    vec![
        ("none", SonicValue::Null, SonicValue::Undefined),
        (
            "raw",
            SonicValue::Bytes(vec![0, 1, 128, 255]),
            SonicValue::Bytes(vec![0, 1, 128, 255]),
        ),
        (
            "ascii",
            strings(&["hello world", "SonicWS", ""]),
            strings(&["hello world", "SonicWS", ""]),
        ),
        (
            "utf16",
            strings(&["another😂", "𐍈", "𝄞", "🧪"]),
            strings(&["another😂", "𐍈", "𝄞", "🧪"]),
        ),
        (
            "enums",
            array([
                SonicValue::String("alpha".into()),
                SonicValue::F64(7.0),
                SonicValue::Bool(true),
                SonicValue::Null,
            ]),
            array([
                SonicValue::String("alpha".into()),
                SonicValue::F64(7.0),
                SonicValue::Bool(true),
                SonicValue::Null,
            ]),
        ),
        (
            "bytes",
            signed(&[-128, -1, 0, 1, 127]),
            signed(&[-128, -1, 0, 1, 127]),
        ),
        (
            "ubytes",
            unsigned(&[0, 1, 254, 255]),
            unsigned(&[0, 1, 254, 255]),
        ),
        (
            "shorts",
            signed(&[-32768, -1, 0, 1, 32767]),
            signed(&[-32768, -1, 0, 1, 32767]),
        ),
        (
            "ushorts",
            unsigned(&[0, 1, 65534, 65535]),
            unsigned(&[0, 1, 65534, 65535]),
        ),
        (
            "varint",
            signed(&[-2147483648, -1, 0, 1, 2147483647]),
            signed(&[-2147483648, -1, 0, 1, 2147483647]),
        ),
        (
            "uvarint",
            unsigned(&[0, 1, 127, 128, 255, 16384, 4294967295]),
            unsigned(&[0, 1, 127, 128, 255, 16384, 4294967295]),
        ),
        (
            "deltas",
            signed(&[-50, -25, 1, 2, 1000, 1004, 1004, -5]),
            signed(&[-50, -25, 1, 2, 1000, 1004, 1004, -5]),
        ),
        (
            "floats",
            array([0.0_f32, 1.5, -1.5, 958412.1, 1e-10].map(SonicValue::F32)),
            array([0.0_f32, 1.5, -1.5, 958412.1, 1e-10].map(SonicValue::F32)),
        ),
        (
            "doubles",
            array([0.0_f64, 1.5, -1.5, 958412.128498, f64::INFINITY].map(SonicValue::F64)),
            array([0.0_f64, 1.5, -1.5, 958412.128498, f64::INFINITY].map(SonicValue::F64)),
        ),
        (
            "booleans",
            array([true, false, true, false, true, false, true, false, true].map(SonicValue::Bool)),
            array([true, false, true, false, true, false, true, false, true].map(SonicValue::Bool)),
        ),
        ("json", json.clone(), array([json])),
        (
            "hex",
            SonicValue::String("00abff".into()),
            SonicValue::String("00abff".into()),
        ),
        (
            "object",
            array([
                strings(&["hello", "world"]),
                array([true, false, true].map(SonicValue::Bool)),
                signed(&[-1, 0, 1]),
            ]),
            array([
                strings(&["hello", "world"]),
                array([true, false, true].map(SonicValue::Bool)),
                signed(&[-1, 0, 1]),
            ]),
        ),
        (
            "compressed",
            strings(&["compressed", "packet"]),
            strings(&["compressed", "packet"]),
        ),
    ]
}

#[tokio::test]
async fn all_packet_modes_are_compatible_in_both_directions() {
    let packets = packet_definitions();
    let server = Server::bind(
        "127.0.0.1:0",
        ServerConfig::new(
            PacketRegistry::new(packets.clone()).unwrap(),
            PacketRegistry::new(packets).unwrap(),
        ),
    )
    .await
    .unwrap();
    let address = server.local_addr().unwrap();
    let accepted = {
        let server = server.clone();
        tokio::spawn(async move { server.accept().await.unwrap() })
    };
    let client = Client::connect(format!("ws://{address}")).await.unwrap();
    let connection = accepted.await.unwrap();

    for (tag, sent, expected) in cases() {
        client.send(tag, &sent).await.unwrap();
        let Incoming::Event(event) = connection.recv().await.unwrap().unwrap() else {
            panic!("event")
        };
        assert_eq!(event.tag, tag);
        assert_compatible(&event.value, &expected);

        connection.send(tag, &sent).await.unwrap();
        let Incoming::Event(event) = client.recv().await.unwrap().unwrap() else {
            panic!("event")
        };
        assert_eq!(event.tag, tag);
        assert_compatible(&event.value, &expected);
    }

    let batches = vec![
        SonicValue::U64(7),
        SonicValue::U64(128),
        SonicValue::U64(16_384),
    ];
    client.send_batch("batch", &batches).await.unwrap();
    for expected in &batches {
        let Incoming::Event(event) = connection.recv().await.unwrap().unwrap() else {
            panic!("batch")
        };
        assert_eq!(event.value, SonicValue::Array(vec![expected.clone()]));
    }
    connection.send_batch("batch", &batches).await.unwrap();
    for expected in &batches {
        let Incoming::Event(event) = client.recv().await.unwrap().unwrap() else {
            panic!("batch")
        };
        assert_eq!(event.value, SonicValue::Array(vec![expected.clone()]));
    }
}
