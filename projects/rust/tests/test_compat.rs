use sonic_ws::{
    Client, EnumPackage, EnumValue, Incoming, Packet, PacketRegistry, PacketType, Server,
    ServerConfig, SonicValue,
};
use std::collections::HashMap;
use tokio::time::{Duration, sleep};

const PORT: u16 = 8963;
const HOST: &str = "127.0.0.1";

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
    array(values.iter().map(|s| SonicValue::String((*s).into())))
}

fn assert_compatible(actual: &SonicValue, expected: &SonicValue) {
    match (actual, expected) {
        (SonicValue::F64(a), SonicValue::F64(b)) if a.is_finite() && b.is_finite() => {
            let tol = b.abs().max(1.0) * f64::EPSILON * 4.0;
            assert!((a - b).abs() <= tol, "{a} != {b}");
        }
        (SonicValue::F32(a), SonicValue::F32(b)) if a.is_finite() && b.is_finite() => {
            let tol = b.abs().max(1.0) * f32::EPSILON * 4.0;
            assert!((a - b).abs() <= tol, "{a} != {b}");
        }
        (SonicValue::Array(a), SonicValue::Array(b)) => {
            assert_eq!(a.len(), b.len(), "array length mismatch");
            for (av, bv) in a.iter().zip(b) {
                assert_compatible(av, bv);
            }
        }
        (SonicValue::Object(a), SonicValue::Object(b)) => {
            assert_eq!(a.len(), b.len(), "object length mismatch");
            for ((ak, av), (bk, bv)) in a.iter().zip(b) {
                assert_eq!(ak, bk);
                assert_compatible(av, bv);
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

fn object_enum() -> EnumPackage {
    EnumPackage {
        name: "compat-object".into(),
        values: vec![
            EnumValue::String("left".into()),
            EnumValue::String("right".into()),
        ],
    }
}

fn make_packets(prefix: &str) -> Vec<Packet> {
    let tag = |name: &str| format!("{prefix}_{name}");
    vec![
        Packet::builder(tag("none"), PacketType::None)
            .build()
            .unwrap(),
        Packet::builder(tag("raw"), PacketType::Raw)
            .data_range(4, 4)
            .build()
            .unwrap(),
        Packet::builder(tag("ascii"), PacketType::StringsAscii)
            .data_range(3, 3)
            .build()
            .unwrap(),
        Packet::builder(tag("utf16"), PacketType::StringsUtf16)
            .data_range(4, 4)
            .build()
            .unwrap(),
        Packet::builder(tag("enums"), PacketType::Enums)
            .data_range(4, 4)
            .enum_data(mixed_enum())
            .build()
            .unwrap(),
        Packet::builder(tag("bytes"), PacketType::Bytes)
            .data_range(5, 5)
            .build()
            .unwrap(),
        Packet::builder(tag("ubytes"), PacketType::UBytes)
            .data_range(4, 4)
            .build()
            .unwrap(),
        Packet::builder(tag("shorts"), PacketType::Shorts)
            .data_range(5, 5)
            .build()
            .unwrap(),
        Packet::builder(tag("ushorts"), PacketType::UShorts)
            .data_range(4, 4)
            .build()
            .unwrap(),
        Packet::builder(tag("varint"), PacketType::VarInt)
            .data_range(5, 5)
            .build()
            .unwrap(),
        Packet::builder(tag("uvarint"), PacketType::UVarInt)
            .data_range(7, 7)
            .build()
            .unwrap(),
        Packet::builder(tag("deltas"), PacketType::Deltas)
            .data_range(8, 8)
            .build()
            .unwrap(),
        Packet::builder(tag("floats"), PacketType::Floats)
            .data_range(5, 5)
            .build()
            .unwrap(),
        Packet::builder(tag("doubles"), PacketType::Doubles)
            .data_range(5, 5)
            .build()
            .unwrap(),
        Packet::builder(tag("booleans"), PacketType::Booleans)
            .data_range(9, 9)
            .build()
            .unwrap(),
        Packet::builder(tag("json"), PacketType::Reserved16)
            .data_range(1, 1)
            .build()
            .unwrap(),
        Packet::builder(tag("hex"), PacketType::Hex)
            .data_range(1, 3)
            .build()
            .unwrap(),
        Packet::object_builder(
            tag("object"),
            [
                PacketType::StringsAscii,
                PacketType::Booleans,
                PacketType::Bytes,
                PacketType::Enums,
                PacketType::Reserved16,
            ],
        )
        .ranges(vec![2, 3, 3, 2, 1], vec![2, 3, 3, 2, 1])
        .enum_data(object_enum())
        .build()
        .unwrap(),
        Packet::builder(tag("batch"), PacketType::UVarInt)
            .data_range(3, 3)
            .batching(10, 4)
            .compression(true)
            .build()
            .unwrap(),
    ]
}

fn cases(prefix: &str) -> Vec<(String, SonicValue, SonicValue)> {
    let tag = |name: &str| format!("{prefix}_{name}");
    let json_val = SonicValue::Object(vec![
        ("ok".into(), SonicValue::Bool(true)),
        (
            "nested".into(),
            array([
                SonicValue::I64(1),
                SonicValue::String("two".into()),
                SonicValue::Bool(false),
                SonicValue::Null,
            ]),
        ),
    ]);
    vec![
        (tag("none"), SonicValue::Null, SonicValue::Undefined),
        (
            tag("raw"),
            SonicValue::Bytes(vec![0, 1, 128, 255]),
            SonicValue::Bytes(vec![0, 1, 128, 255]),
        ),
        (
            tag("ascii"),
            strings(&["hello world", "SonicWS", ""]),
            strings(&["hello world", "SonicWS", ""]),
        ),
        (
            tag("utf16"),
            strings(&["another😂", "𐍈", "𝄞", "🧪"]),
            strings(&["another😂", "𐍈", "𝄞", "🧪"]),
        ),
        (
            tag("enums"),
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
            tag("bytes"),
            signed(&[-128, -1, 0, 1, 127]),
            signed(&[-128, -1, 0, 1, 127]),
        ),
        (
            tag("ubytes"),
            unsigned(&[0, 1, 254, 255]),
            unsigned(&[0, 1, 254, 255]),
        ),
        (
            tag("shorts"),
            signed(&[-32768, -1, 0, 1, 32767]),
            signed(&[-32768, -1, 0, 1, 32767]),
        ),
        (
            tag("ushorts"),
            unsigned(&[0, 1, 65534, 65535]),
            unsigned(&[0, 1, 65534, 65535]),
        ),
        (
            tag("varint"),
            signed(&[-2147483648, -1, 0, 1, 2147483647]),
            signed(&[-2147483648, -1, 0, 1, 2147483647]),
        ),
        (
            tag("uvarint"),
            unsigned(&[0, 1, 127, 128, 255, 16384, 4294967295]),
            unsigned(&[0, 1, 127, 128, 255, 16384, 4294967295]),
        ),
        (
            tag("deltas"),
            signed(&[-50, -25, 1, 2, 1000, 1004, 1004, -5]),
            signed(&[-50, -25, 1, 2, 1000, 1004, 1004, -5]),
        ),
        (
            tag("floats"),
            array([0.0_f32, 1.5, -1.5, 958412.1, 1e-10].map(SonicValue::F32)),
            array([0.0_f32, 1.5, -1.5, 958412.1, 1e-10].map(SonicValue::F32)),
        ),
        (
            tag("doubles"),
            array([0.0_f64, 1.5, -1.5, 958412.128498, f64::INFINITY].map(SonicValue::F64)),
            array([0.0_f64, 1.5, -1.5, 958412.128498, f64::INFINITY].map(SonicValue::F64)),
        ),
        (
            tag("booleans"),
            array([true, false, true, false, true, false, true, false, true].map(SonicValue::Bool)),
            array([true, false, true, false, true, false, true, false, true].map(SonicValue::Bool)),
        ),
        (tag("json"), array([json_val.clone()]), array([json_val])),
        (
            tag("hex"),
            SonicValue::String("00abff".into()),
            SonicValue::String("00abff".into()),
        ),
        (
            tag("object"),
            array([
                strings(&["hello", "world"]),
                array([true, false, true].map(SonicValue::Bool)),
                signed(&[-1, 0, 1]),
                strings(&["right", "left"]),
                array([SonicValue::Object(vec![(
                    "json".into(),
                    SonicValue::Bool(true),
                )])]),
            ]),
            array([
                strings(&["hello", "world"]),
                array([true, false, true].map(SonicValue::Bool)),
                signed(&[-1, 0, 1]),
                strings(&["right", "left"]),
                array([SonicValue::Object(vec![(
                    "json".into(),
                    SonicValue::Bool(true),
                )])]),
            ]),
        ),
    ]
}

async fn send_all(label: &str, sender: &sonic_ws::Connection, prefix: &str) {
    let data = cases(prefix);
    for (tag, value, _) in &data {
        println!("[{label}] sending {tag}");
        sender.send(tag, value).await.unwrap();
    }
    let batch_tag = format!("{prefix}_batch");
    let batch_item = array([
        SonicValue::U64(7),
        SonicValue::U64(128),
        SonicValue::U64(16384),
    ]);
    println!("[{label}] sending {batch_tag}");
    sender.send_batch(&batch_tag, &[batch_item]).await.unwrap();
    sleep(Duration::from_millis(100)).await;
}

async fn wait_all(label: &str, receiver: &sonic_ws::Connection, prefix: &str) {
    let data = cases(prefix);
    let mut expected: HashMap<String, SonicValue> =
        data.into_iter().map(|(tag, _, exp)| (tag, exp)).collect();
    let batch_tag = format!("{prefix}_batch");
    expected.insert(
        batch_tag,
        array([
            SonicValue::U64(7),
            SonicValue::U64(128),
            SonicValue::U64(16384),
        ]),
    );

    let total = expected.len();
    let mut received = 0;

    while received < total {
        let incoming = receiver.recv().await.unwrap().unwrap();
        let Incoming::Event(event) = incoming else {
            continue;
        };
        let tag = &event.tag;
        if let Some(exp) = expected.get(tag) {
            println!("[{label}] received {tag}");
            assert_compatible(&event.value, exp);
            received += 1;
        } else {
            panic!("[{label}] unexpected tag: {tag}");
        }
    }
}

async fn run_host() {
    let server_packets = make_packets("server");
    let client_packets = make_packets("client");

    let server = Server::bind(
        format!("{HOST}:{PORT}"),
        ServerConfig::new(
            PacketRegistry::new(client_packets).unwrap(),
            PacketRegistry::new(server_packets).unwrap(),
        ),
    )
    .await
    .unwrap();

    println!("Host listening on {HOST}:{PORT}");
    let connection = server.accept().await.unwrap();
    println!("Client connected");

    let conn_recv = connection.clone();
    let recv_task = tokio::spawn(async move {
        wait_all("Host", &conn_recv, "client").await;
    });

    sleep(Duration::from_millis(250)).await;
    send_all("Host", &connection, "server").await;

    recv_task.await.unwrap();
    println!("Host done");
}

async fn run_client() {
    let url = format!("ws://{HOST}:{PORT}");
    let client = Client::connect(&url).await.unwrap();
    println!("Connected to {url}");

    let client_recv = client.clone();
    let recv_task = tokio::spawn(async move {
        wait_all("Client", &client_recv, "server").await;
    });

    sleep(Duration::from_millis(500)).await;
    send_all("Client", &client, "client").await;

    recv_task.await.unwrap();
    println!("Client done");
}

#[tokio::main]
async fn main() {
    let args: Vec<String> = std::env::args().collect();
    let mode = args.get(1).map(String::as_str);
    match mode {
        Some("--host") => run_host().await,
        Some("--client") => run_client().await,
        _ => {
            eprintln!("Usage: test_compat --host | --client");
            std::process::exit(1);
        }
    }
}
