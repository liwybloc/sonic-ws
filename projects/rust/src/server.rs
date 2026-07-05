use std::time::{Duration, Instant};
use std::{
    collections::{HashMap, HashSet},
    net::SocketAddr,
    sync::{
        Arc,
        atomic::{AtomicU64, Ordering},
    },
};

use tokio::{net::TcpListener, sync::RwLock};
use tokio_tungstenite::{accept_async, tungstenite::Message};
use uuid::Uuid;

use sonic_ws_core::SonicValue;

use crate::{
    Connection, Error, Listeners, PROTOCOL_VERSION, PacketRegistry, Result,
    connection::{bridge, write_varint},
};

/// Packet tables and resource limits for a server.
#[derive(Debug, Clone)]
pub struct ServerConfig {
    pub client_packets: PacketRegistry,
    pub server_packets: PacketRegistry,
    pub max_connections: usize,
    pub inbound_rate_limit: u32,
    pub max_message_size: usize,
    pub recovery_duration: Duration,
    pub max_replay_packets: usize,
}

impl ServerConfig {
    pub fn new(client_packets: PacketRegistry, server_packets: PacketRegistry) -> Self {
        Self {
            client_packets,
            server_packets,
            max_connections: 10_000,
            inbound_rate_limit: 500,
            max_message_size: 8 * 1024 * 1024,
            recovery_duration: Duration::from_secs(120),
            max_replay_packets: 1_000,
        }
    }
}

struct ServerInner {
    listener: TcpListener,
    config: ServerConfig,
    next_id: AtomicU64,
    connections: RwLock<HashMap<u64, Connection>>,
    rooms: RwLock<HashMap<String, HashSet<u64>>>,
    connection_rooms: RwLock<HashMap<u64, HashSet<String>>>,
    sessions: RwLock<HashMap<String, RecoverySession>>,
    listeners: Listeners,
}

#[derive(Clone)]
struct RecoverySession {
    state: serde_json::Map<String, serde_json::Value>,
    rooms: HashSet<String>,
    frames: Vec<(u64, Vec<u8>)>,
    expires: Instant,
}

/// A Tokio WebSocket server using the SonicWS v24 handshake and packet model.
#[derive(Clone)]
pub struct Server {
    inner: Arc<ServerInner>,
}

impl Server {
    pub async fn bind(
        address: impl tokio::net::ToSocketAddrs,
        config: ServerConfig,
    ) -> Result<Self> {
        if config.max_connections == 0 {
            return Err(Error::Protocol("max_connections must be positive".into()));
        }
        if config.max_message_size == 0 {
            return Err(Error::Protocol("max_message_size must be positive".into()));
        }
        let listener = TcpListener::bind(address).await?;
        Ok(Self {
            inner: Arc::new(ServerInner {
                listener,
                config,
                next_id: AtomicU64::new(1),
                connections: RwLock::new(HashMap::new()),
                rooms: RwLock::new(HashMap::new()),
                connection_rooms: RwLock::new(HashMap::new()),
                sessions: RwLock::new(HashMap::new()),
                listeners: Listeners::new(),
            }),
        })
    }

    pub fn local_addr(&self) -> Result<SocketAddr> {
        Ok(self.inner.listener.local_addr()?)
    }

    /// Accepts one WebSocket, sends the schema handshake, and registers it.
    pub async fn accept(&self) -> Result<Connection> {
        self.inner
            .sessions
            .write()
            .await
            .retain(|_, session| session.expires >= Instant::now());
        if self.inner.connections.read().await.len() >= self.inner.config.max_connections {
            return Err(Error::Protocol("server connection limit reached".into()));
        }
        let (stream, _) = self.inner.listener.accept().await?;
        let mut socket = accept_async(stream).await?;
        let id = self.inner.next_id.fetch_add(1, Ordering::Relaxed);
        let session_id = Uuid::new_v4().to_string();
        let handshake = build_handshake(
            id,
            &session_id,
            &self.inner.config.client_packets,
            &self.inner.config.server_packets,
        )?;
        use futures_util::SinkExt;
        socket.send(Message::Binary(handshake)).await?;
        let transport = bridge(socket, self.inner.config.max_message_size);
        let connection = Connection::new(
            id,
            session_id,
            self.inner.config.client_packets.clone(),
            self.inner.config.server_packets.clone(),
            transport,
            self.inner.config.inbound_rate_limit,
            self.inner.config.max_replay_packets,
        );
        self.inner
            .connections
            .write()
            .await
            .insert(id, connection.clone());
        let server = self.clone();
        let monitored = connection.clone();
        tokio::spawn(async move {
            monitored.wait_closed().await;
            server.remove(id).await;
        });
        Ok(connection)
    }

    pub async fn connection(&self, id: u64) -> Option<Connection> {
        self.inner.connections.read().await.get(&id).cloned()
    }
    pub async fn connection_count(&self) -> usize {
        self.inner.connections.read().await.len()
    }

    /// Registers an async packet listener.
    pub fn on<F, Fut>(&self, tag: impl Into<String>, handler: F)
    where
        F: Fn(crate::Event) -> Fut + Send + Sync + 'static,
        Fut: std::future::Future<Output = ()> + Send + 'static,
    {
        self.inner.listeners.on(tag, handler);
    }

    /// Registers an async packet listener with access to its connection.
    pub fn on_with_connection<F, Fut>(&self, tag: impl Into<String>, handler: F)
    where
        F: Fn(Connection, crate::Event) -> Fut + Send + Sync + 'static,
        Fut: std::future::Future<Output = ()> + Send + 'static,
    {
        self.inner.listeners.on_with_connection(tag, handler);
    }

    pub fn on_connect<F, Fut>(&self, handler: F)
    where
        F: Fn(Connection) -> Fut + Send + Sync + 'static,
        Fut: std::future::Future<Output = ()> + Send + 'static,
    {
        self.inner.listeners.on_connect(handler);
    }

    /// Accepts connections forever and dispatches registered listeners.
    pub async fn run(&self) -> Result<()> {
        loop {
            let connection = self.accept().await?;
            let server = self.clone();
            tokio::spawn(async move {
                let _ = server.serve_connection(connection).await;
            });
        }
    }

    /// Dispatches one accepted connection until it closes.
    pub async fn serve_connection(&self, connection: Connection) -> Result<()> {
        self.inner.listeners.connected(connection.clone()).await;
        while let Some(message) = self.recv(&connection).await? {
            if let crate::Incoming::Event(event) = message {
                self.inner
                    .listeners
                    .dispatch(connection.clone(), event)
                    .await;
            }
        }
        Ok(())
    }

    /// Removes a closed connection and all of its room memberships.
    pub async fn remove(&self, id: u64) {
        let connection = self.inner.connections.write().await.remove(&id);
        let memberships = self
            .inner
            .connection_rooms
            .write()
            .await
            .remove(&id)
            .unwrap_or_default();
        if let Some(connection) = connection {
            self.inner.sessions.write().await.insert(
                connection.session_id().to_owned(),
                RecoverySession {
                    state: connection.state_snapshot().await,
                    rooms: memberships.clone(),
                    frames: connection.replay_snapshot().await,
                    expires: Instant::now() + self.inner.config.recovery_duration,
                },
            );
        }
        let mut rooms = self.inner.rooms.write().await;
        for room in memberships {
            if let Some(members) = rooms.get_mut(&room) {
                members.remove(&id);
                if members.is_empty() {
                    rooms.remove(&room);
                }
            }
        }
    }

    /// Receives a message and handles recovery control frames automatically.
    pub async fn recv(&self, connection: &Connection) -> Result<Option<crate::Incoming>> {
        loop {
            match connection.recv().await? {
                Some(crate::Incoming::Resume {
                    session_id,
                    last_sequence,
                }) => {
                    self.resume(connection, &session_id, last_sequence).await?;
                }
                message => return Ok(message),
            }
        }
    }

    pub async fn resume(
        &self,
        connection: &Connection,
        session_id: &str,
        last_sequence: u64,
    ) -> Result<bool> {
        let session = self.inner.sessions.write().await.remove(session_id);
        let Some(session) = session.filter(|session| session.expires >= Instant::now()) else {
            connection
                .send_frame(crate::control::encode(&crate::control::Control::Resumed {
                    recovered: false,
                    replayed: 0,
                })?)
                .await?;
            return Ok(false);
        };
        connection.replace_state(session.state).await;
        for room in session.rooms {
            self.join(connection.id(), room).await?;
        }
        connection.restore_replay(session.frames.clone()).await;
        let frames = session
            .frames
            .into_iter()
            .filter(|(sequence, _)| *sequence > last_sequence)
            .collect::<Vec<_>>();
        for (_, frame) in &frames {
            connection.send_frame(frame.clone()).await?;
        }
        connection
            .send_frame(crate::control::encode(&crate::control::Control::Resumed {
                recovered: true,
                replayed: frames.len() as u64,
            })?)
            .await?;
        Ok(true)
    }

    pub async fn join(&self, connection_id: u64, room: impl Into<String>) -> Result<()> {
        if !self
            .inner
            .connections
            .read()
            .await
            .contains_key(&connection_id)
        {
            return Err(Error::Protocol(format!(
                "connection {connection_id} is not active"
            )));
        }
        let room = room.into();
        self.inner
            .rooms
            .write()
            .await
            .entry(room.clone())
            .or_default()
            .insert(connection_id);
        self.inner
            .connection_rooms
            .write()
            .await
            .entry(connection_id)
            .or_default()
            .insert(room);
        Ok(())
    }

    pub async fn leave(&self, connection_id: u64, room: &str) {
        if let Some(members) = self.inner.rooms.write().await.get_mut(room) {
            members.remove(&connection_id);
        }
        if let Some(rooms) = self
            .inner
            .connection_rooms
            .write()
            .await
            .get_mut(&connection_id)
        {
            rooms.remove(room);
        }
    }

    pub async fn broadcast(&self, tag: &str, value: &SonicValue) -> Vec<(u64, Error)> {
        let connections = self
            .inner
            .connections
            .read()
            .await
            .values()
            .cloned()
            .collect::<Vec<_>>();
        send_many(connections, tag, value).await
    }

    pub async fn broadcast_room(
        &self,
        room: &str,
        tag: &str,
        value: &SonicValue,
    ) -> Vec<(u64, Error)> {
        let ids = self
            .inner
            .rooms
            .read()
            .await
            .get(room)
            .cloned()
            .unwrap_or_default();
        let connections = self.inner.connections.read().await;
        let connections = ids
            .into_iter()
            .filter_map(|id| connections.get(&id).cloned())
            .collect();
        send_many(connections, tag, value).await
    }

    pub async fn broadcast_permutation_flags(
        &self,
        parent: &str,
        flags: &[bool],
        value: &SonicValue,
    ) -> Vec<(u64, Error)> {
        let tag = match self
            .inner
            .config
            .server_packets
            .permutation_tag_flags(parent, flags)
        {
            Ok(tag) => tag,
            Err(error) => return vec![(0, error)],
        };
        self.broadcast(&tag, value).await
    }

    pub async fn broadcast_permutation_map(
        &self,
        parent: &str,
        flags: &HashMap<String, bool>,
        value: &SonicValue,
    ) -> Vec<(u64, Error)> {
        let tag = match self
            .inner
            .config
            .server_packets
            .permutation_tag_map(parent, flags)
        {
            Ok(tag) => tag,
            Err(error) => return vec![(0, error)],
        };
        self.broadcast(&tag, value).await
    }
}

async fn send_many(
    connections: Vec<Connection>,
    tag: &str,
    value: &SonicValue,
) -> Vec<(u64, Error)> {
    let mut errors = Vec::new();
    for connection in connections {
        if let Err(error) = connection.send(tag, value).await {
            errors.push((connection.id(), error));
        }
    }
    errors
}

fn build_handshake(
    id: u64,
    session_id: &str,
    client: &PacketRegistry,
    server: &PacketRegistry,
) -> Result<Vec<u8>> {
    let client = client.serialize()?;
    let server = server.serialize()?;
    let mut data = Vec::new();
    write_varint(id, &mut data);
    write_varint(session_id.len() as u64, &mut data);
    data.extend(session_id.as_bytes());
    write_varint(client.len() as u64, &mut data);
    data.extend(client);
    data.extend(server);
    let compressed = sonic_ws_core::compression::gzip::compress(&data)?;
    let mut output = Vec::with_capacity(compressed.len() + 4);
    output.extend(b"SWS");
    output.push(PROTOCOL_VERSION);
    output.extend(compressed);
    Ok(output)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{Incoming, Packet};
    use sonic_ws_core::PacketType;

    #[tokio::test]
    async fn client_and_server_exchange_schema_mapped_packets() {
        let movement = Packet::builder("movement", PacketType::VarInt)
            .data_range(3, 3)
            .schema(["x", "y", "z"])
            .build()
            .unwrap();
        let repeat = Packet::builder("repeat", PacketType::UVarInt)
            .rereference(true)
            .build()
            .unwrap();
        let reply = Packet::builder("reply", PacketType::StringsUtf16)
            .build()
            .unwrap();
        let server = Server::bind(
            "127.0.0.1:0",
            ServerConfig::new(
                PacketRegistry::new([movement, repeat]).unwrap(),
                PacketRegistry::new([reply]).unwrap(),
            ),
        )
        .await
        .unwrap();
        let address = server.local_addr().unwrap();
        let accepted = {
            let server = server.clone();
            tokio::spawn(async move { server.accept().await.unwrap() })
        };
        let client = crate::Client::connect(format!("ws://{address}"))
            .await
            .unwrap();
        let connection = accepted.await.unwrap();
        client
            .send(
                "movement",
                &SonicValue::Object(vec![
                    ("x".into(), SonicValue::I64(1)),
                    ("y".into(), SonicValue::I64(2)),
                    ("z".into(), SonicValue::I64(3)),
                ]),
            )
            .await
            .unwrap();
        let crate::Incoming::Event(event) = connection.recv().await.unwrap().unwrap() else {
            panic!("expected event")
        };
        assert_eq!(
            event.value,
            SonicValue::Object(vec![
                ("x".into(), SonicValue::I64(1)),
                ("y".into(), SonicValue::I64(2)),
                ("z".into(), SonicValue::I64(3))
            ])
        );

        let repeated = SonicValue::U64(42);
        client.send("repeat", &repeated).await.unwrap();
        client.send("repeat", &repeated).await.unwrap();
        let Incoming::Event(first) = connection.recv().await.unwrap().unwrap() else {
            panic!("expected first rereference event")
        };
        let Incoming::Event(second) = connection.recv().await.unwrap().unwrap() else {
            panic!("expected repeated event")
        };
        assert_eq!(first.value, second.value);

        let request_id = client
            .request(
                "movement",
                &SonicValue::Object(vec![
                    ("x".into(), SonicValue::I64(4)),
                    ("y".into(), SonicValue::I64(5)),
                    ("z".into(), SonicValue::I64(6)),
                ]),
            )
            .await
            .unwrap();
        let Incoming::Request(request) = connection.recv().await.unwrap().unwrap() else {
            panic!("expected request")
        };
        connection
            .respond(request.id, Ok(serde_json::json!({"accepted": true})))
            .await
            .unwrap();
        let Incoming::Response { id, result } = client.recv().await.unwrap().unwrap() else {
            panic!("expected response")
        };
        assert_eq!(id, request_id);
        assert_eq!(result.unwrap(), serde_json::json!({"accepted": true}));

        connection.set_state("player", serde_json::json!(7)).await;
        assert_eq!(connection.state("player").await, Some(serde_json::json!(7)));
        server.join(connection.id(), "players").await.unwrap();
        assert!(
            server
                .broadcast_room("players", "reply", &SonicValue::String("room".into()))
                .await
                .is_empty()
        );
        let Incoming::Event(room_event) = client.recv().await.unwrap().unwrap() else {
            panic!("expected room event")
        };
        assert_eq!(
            room_event.value,
            SonicValue::Array(vec![SonicValue::String("room".into())])
        );

        connection
            .send("reply", &SonicValue::String("ok".into()))
            .await
            .unwrap();
        let crate::Incoming::Event(event) = client.recv().await.unwrap().unwrap() else {
            panic!("expected event")
        };
        assert_eq!(
            event.value,
            SonicValue::Array(vec![SonicValue::String("ok".into())])
        );
    }
}
