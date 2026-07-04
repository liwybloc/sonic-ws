use serde_json::json;
use sonic_ws::{
    Client, Incoming, Packet, PacketRegistry, PacketType, Server, ServerConfig, SonicValue,
};

fn movement(x: i64, y: i64, z: i64) -> SonicValue {
    SonicValue::Object(vec![
        ("x".into(), SonicValue::I64(x)),
        ("y".into(), SonicValue::I64(y)),
        ("z".into(), SonicValue::I64(z)),
    ])
}

async fn pair() -> (Server, sonic_ws::Connection, sonic_ws::Connection) {
    let movement_packet = Packet::builder("movement", PacketType::VarInt)
        .data_range(3, 3)
        .schema(["x", "y", "z"])
        .build()
        .unwrap();
    let repeat = Packet::builder("repeat", PacketType::UVarInt)
        .rereference(true)
        .build()
        .unwrap();
    let reply = Packet::builder("reply", PacketType::StringsUtf16)
        .data_range(1, 1)
        .build()
        .unwrap();
    let server = Server::bind(
        "127.0.0.1:0",
        ServerConfig::new(
            PacketRegistry::new([movement_packet, repeat]).unwrap(),
            PacketRegistry::new([reply]).unwrap(),
        ),
    )
    .await
    .unwrap();
    let address = server.local_addr().unwrap();
    let accept = {
        let server = server.clone();
        tokio::spawn(async move { server.accept().await.unwrap() })
    };
    let client = Client::connect(format!("ws://{address}")).await.unwrap();
    let connection = accept.await.unwrap();
    (server, connection, client)
}

#[tokio::test]
async fn negotiates_schemas_and_exchanges_validated_packets() {
    let (_server, server_connection, client) = pair().await;
    client.send("movement", &movement(1, 2, 3)).await.unwrap();
    let Incoming::Event(event) = server_connection.recv().await.unwrap().unwrap() else {
        panic!("expected event")
    };
    assert_eq!(event.tag, "movement");
    assert_eq!(event.value, movement(1, 2, 3));

    server_connection
        .send("reply", &SonicValue::String("accepted".into()))
        .await
        .unwrap();
    let Incoming::Event(event) = client.recv().await.unwrap().unwrap() else {
        panic!("expected reply")
    };
    assert_eq!(
        event.value,
        SonicValue::Array(vec![SonicValue::String("accepted".into())])
    );
}

#[tokio::test]
async fn rpc_rooms_state_and_rereference_work_together() {
    let (server, server_connection, client) = pair().await;
    let repeated = SonicValue::U64(42);
    client.send("repeat", &repeated).await.unwrap();
    client.send("repeat", &repeated).await.unwrap();
    let Incoming::Event(first) = server_connection.recv().await.unwrap().unwrap() else {
        panic!()
    };
    let Incoming::Event(second) = server_connection.recv().await.unwrap().unwrap() else {
        panic!()
    };
    assert_eq!(first.value, second.value);

    let id = client
        .request("movement", &movement(4, 5, 6))
        .await
        .unwrap();
    let Incoming::Request(request) = server_connection.recv().await.unwrap().unwrap() else {
        panic!("expected request")
    };
    server_connection
        .respond(request.id, Ok(json!({"accepted": true})))
        .await
        .unwrap();
    let Incoming::Response {
        id: response_id,
        result,
    } = client.recv().await.unwrap().unwrap()
    else {
        panic!("expected response")
    };
    assert_eq!(response_id, id);
    assert_eq!(result.unwrap(), json!({"accepted": true}));

    server_connection.set_state("player_id", json!(9)).await;
    assert_eq!(server_connection.state("player_id").await, Some(json!(9)));
    server
        .join(server_connection.id(), "players")
        .await
        .unwrap();
    assert!(
        server
            .broadcast_room("players", "reply", &SonicValue::String("room".into()))
            .await
            .is_empty()
    );
    let Incoming::Event(event) = client.recv().await.unwrap().unwrap() else {
        panic!()
    };
    assert_eq!(
        event.value,
        SonicValue::Array(vec![SonicValue::String("room".into())])
    );
}

#[tokio::test]
async fn closed_connections_are_removed_from_server_and_rooms() {
    let (server, connection, client) = pair().await;
    server.join(connection.id(), "players").await.unwrap();
    assert_eq!(server.connection_count().await, 1);
    client.close().await.unwrap();

    tokio::time::timeout(std::time::Duration::from_secs(2), async {
        while server.connection_count().await != 0 {
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("server did not remove the closed connection");
}

#[tokio::test]
async fn invalid_packet_tags_return_errors_without_writing_frames() {
    let (_server, _connection, client) = pair().await;
    assert!(client.send("missing", &SonicValue::Null).await.is_err());
}

#[tokio::test]
async fn global_and_packet_rate_limits_reject_excess_messages() {
    let packet = Packet::builder("limited", PacketType::UVarInt)
        .rate_limit(1)
        .build()
        .unwrap();
    let mut config = ServerConfig::new(
        PacketRegistry::new([packet]).unwrap(),
        PacketRegistry::default(),
    );
    config.inbound_rate_limit = 10;
    let server = Server::bind("127.0.0.1:0", config).await.unwrap();
    let address = server.local_addr().unwrap();
    let accepted = {
        let server = server.clone();
        tokio::spawn(async move { server.accept().await.unwrap() })
    };
    let client = Client::connect(format!("ws://{address}")).await.unwrap();
    let connection = accepted.await.unwrap();

    client.send("limited", &SonicValue::U64(1)).await.unwrap();
    client.send("limited", &SonicValue::U64(2)).await.unwrap();
    assert!(matches!(
        connection.recv().await.unwrap(),
        Some(Incoming::Event(_))
    ));
    assert!(connection.recv().await.is_err());
}

#[tokio::test]
async fn disabled_packets_can_be_enabled_per_connection() {
    let packet = Packet::builder("gated", PacketType::None)
        .enabled(false)
        .build()
        .unwrap();
    let server = Server::bind(
        "127.0.0.1:0",
        ServerConfig::new(
            PacketRegistry::new([packet]).unwrap(),
            PacketRegistry::default(),
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
    connection.enable_packet("gated").await.unwrap();
    client.send("gated", &SonicValue::Null).await.unwrap();
    assert!(matches!(
        connection.recv().await.unwrap(),
        Some(Incoming::Event(_))
    ));
}

#[tokio::test]
async fn reconnect_recovery_restores_state_rooms_and_replay_frames() {
    let inbound = Packet::builder("input", PacketType::None).build().unwrap();
    let replay = Packet::builder("snapshot", PacketType::UVarInt)
        .replay(true)
        .build()
        .unwrap();
    let room = Packet::builder("room", PacketType::StringsUtf16)
        .build()
        .unwrap();
    let server = Server::bind(
        "127.0.0.1:0",
        ServerConfig::new(
            PacketRegistry::new([inbound]).unwrap(),
            PacketRegistry::new([replay, room]).unwrap(),
        ),
    )
    .await
    .unwrap();
    let address = server.local_addr().unwrap();
    let accepted = {
        let server = server.clone();
        tokio::spawn(async move { server.accept().await.unwrap() })
    };
    let first_client = Client::connect(format!("ws://{address}")).await.unwrap();
    let first = accepted.await.unwrap();
    let old_session = first_client.session_id().to_owned();
    first.set_state("player_id", json!(77)).await;
    server.join(first.id(), "players").await.unwrap();
    first.send("snapshot", &SonicValue::U64(5)).await.unwrap();
    let Incoming::Event(_) = first_client.recv().await.unwrap().unwrap() else {
        panic!()
    };
    assert_eq!(first_client.recovery_checkpoint(), 1);
    first_client.close().await.unwrap();
    tokio::time::timeout(std::time::Duration::from_secs(2), async {
        while server.connection_count().await != 0 {
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();

    let replacement_accept = {
        let server = server.clone();
        tokio::spawn(async move { server.accept().await.unwrap() })
    };
    let replacement_client = Client::resume(format!("ws://{address}"), old_session, 0)
        .await
        .unwrap();
    let replacement = replacement_accept.await.unwrap();
    let Some(Incoming::Resume {
        session_id,
        last_sequence,
    }) = replacement.recv().await.unwrap()
    else {
        panic!("resume frame")
    };
    assert!(
        server
            .resume(&replacement, &session_id, last_sequence)
            .await
            .unwrap()
    );
    assert_eq!(replacement.state("player_id").await, Some(json!(77)));

    let Incoming::Event(replayed) = replacement_client.recv().await.unwrap().unwrap() else {
        panic!("replay")
    };
    assert_eq!(replayed.value, SonicValue::Array(vec![SonicValue::U64(5)]));
    let Incoming::Recovery {
        recovered,
        replayed,
    } = replacement_client.recv().await.unwrap().unwrap()
    else {
        panic!("recovery result")
    };
    assert!(recovered);
    assert_eq!(replayed, 1);
    assert!(
        server
            .broadcast_room("players", "room", &SonicValue::String("restored".into()))
            .await
            .is_empty()
    );
    assert!(matches!(
        replacement_client.recv().await.unwrap(),
        Some(Incoming::Event(_))
    ));
}

#[tokio::test]
async fn server_listener_api_dispatches_async_packet_handlers() {
    let movement_packet = Packet::builder("movement", PacketType::VarInt)
        .data_range(3, 3)
        .schema(["x", "y", "z"])
        .build()
        .unwrap();
    let reply = Packet::builder("reply", PacketType::StringsUtf16)
        .build()
        .unwrap();
    let server = Server::bind(
        "127.0.0.1:0",
        ServerConfig::new(
            PacketRegistry::new([movement_packet]).unwrap(),
            PacketRegistry::new([reply]).unwrap(),
        ),
    )
    .await
    .unwrap();
    let address = server.local_addr().unwrap();
    let (seen_tx, mut seen_rx) = tokio::sync::mpsc::channel(1);
    server.on_with_connection("movement", move |connection, event| {
        let seen_tx = seen_tx.clone();
        async move {
            seen_tx.send(event.value).await.unwrap();
            connection
                .send("reply", &SonicValue::String("listener".into()))
                .await
                .unwrap();
        }
    });
    let running = {
        let server = server.clone();
        tokio::spawn(async move { server.run().await })
    };
    let client = Client::connect(format!("ws://{address}")).await.unwrap();
    client.send("movement", &movement(8, 9, 10)).await.unwrap();
    assert_eq!(seen_rx.recv().await.unwrap(), movement(8, 9, 10));
    assert!(matches!(
        client.recv().await.unwrap(),
        Some(Incoming::Event(_))
    ));
    running.abort();
}
