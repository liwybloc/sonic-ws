use std::time::{Duration, Instant};
use std::{
    collections::{HashMap, HashSet, VecDeque},
    sync::{
        Arc,
        atomic::{AtomicU64, Ordering},
    },
};

use futures_util::{Sink, SinkExt, Stream, StreamExt};
use serde_json::Value;
use tokio::sync::{Mutex, RwLock, mpsc, watch};
use tokio_tungstenite::{connect_async, tungstenite::Message};

use sonic_ws_core::{SonicValue, batching};

use crate::{Error, PROTOCOL_VERSION, PacketRegistry, Result, control};

/// A decoded ordinary packet.
#[derive(Debug, Clone, PartialEq)]
pub struct Event {
    pub tag: String,
    pub value: SonicValue,
    pub parent: Option<String>,
    pub variant: Option<String>,
    pub permutation: Option<HashMap<String, bool>>,
}

/// An RPC request received through a SonicWS control frame.
#[derive(Debug, Clone, PartialEq)]
pub struct Request {
    pub id: u64,
    pub packet_key: u8,
    pub event: Event,
}

/// Messages returned by [`Connection::recv`].
#[derive(Debug, Clone, PartialEq)]
pub enum Incoming {
    Event(Event),
    Request(Request),
    Response {
        id: u64,
        result: std::result::Result<Value, String>,
    },
    Recovery {
        recovered: bool,
        replayed: u64,
    },
    Resume {
        session_id: String,
        last_sequence: u64,
    },
}

pub(crate) struct ConnectionInner {
    pub id: u64,
    pub session_id: String,
    pub inbound_packets: PacketRegistry,
    pub outbound_packets: PacketRegistry,
    writer: mpsc::Sender<Message>,
    reader: Mutex<mpsc::Receiver<Result<Vec<u8>>>>,
    decoded: Mutex<VecDeque<Incoming>>,
    last_sent: Mutex<HashMap<u8, SonicValue>>,
    last_received: Mutex<HashMap<u8, SonicValue>>,
    request_id: AtomicU64,
    state: RwLock<serde_json::Map<String, Value>>,
    closed: watch::Receiver<bool>,
    enabled_packets: RwLock<HashSet<u8>>,
    inbound_rate_limit: u32,
    rate_state: Mutex<RateState>,
    replay_sequence: AtomicU64,
    replay_frames: Mutex<VecDeque<(u64, Vec<u8>)>>,
    max_replay_packets: usize,
    last_replay_sequence: AtomicU64,
    last_activity: Mutex<Instant>,
    heartbeat_responder: bool,
}

pub(crate) struct TransportParts {
    writer: mpsc::Sender<Message>,
    reader: mpsc::Receiver<Result<Vec<u8>>>,
    closed: watch::Receiver<bool>,
}

pub(crate) struct ConnectionOptions {
    pub inbound_rate_limit: u32,
    pub max_replay_packets: usize,
    pub heartbeat_responder: bool,
}

struct RateState {
    started: Instant,
    global: u32,
    packets: HashMap<u8, u32>,
}

impl RateState {
    fn new() -> Self {
        Self {
            started: Instant::now(),
            global: 0,
            packets: HashMap::new(),
        }
    }
    fn allow(&mut self, global_limit: u32, packet_key: u8, packet_limit: u32, amount: u32) -> bool {
        if self.started.elapsed() >= Duration::from_secs(1) {
            self.started = Instant::now();
            self.global = 0;
            self.packets.clear();
        }
        self.global = self.global.saturating_add(amount);
        let packet_count = self.packets.entry(packet_key).or_default();
        *packet_count = packet_count.saturating_add(amount);
        (global_limit == 0 || self.global <= global_limit)
            && (packet_limit == 0 || *packet_count <= packet_limit)
    }
}

/// A cloneable, asynchronous SonicWS connection.
#[derive(Clone)]
pub struct Connection {
    pub(crate) inner: Arc<ConnectionInner>,
}

impl std::fmt::Debug for Connection {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("Connection")
            .field("id", &self.id())
            .field("session_id", &self.session_id())
            .finish_non_exhaustive()
    }
}

impl Connection {
    pub(crate) fn new(
        id: u64,
        session_id: String,
        inbound_packets: PacketRegistry,
        outbound_packets: PacketRegistry,
        transport: TransportParts,
        options: ConnectionOptions,
    ) -> Self {
        let enabled_packets = inbound_packets
            .packets()
            .enumerate()
            .filter_map(|(index, packet)| packet.enabled.then_some((index + 1) as u8))
            .collect();
        Self {
            inner: Arc::new(ConnectionInner {
                id,
                session_id,
                inbound_packets,
                outbound_packets,
                writer: transport.writer,
                reader: Mutex::new(transport.reader),
                decoded: Mutex::new(VecDeque::new()),
                last_sent: Mutex::new(HashMap::new()),
                last_received: Mutex::new(HashMap::new()),
                request_id: AtomicU64::new(1),
                state: RwLock::new(serde_json::Map::new()),
                closed: transport.closed,
                enabled_packets: RwLock::new(enabled_packets),
                inbound_rate_limit: options.inbound_rate_limit,
                rate_state: Mutex::new(RateState::new()),
                replay_sequence: AtomicU64::new(0),
                replay_frames: Mutex::new(VecDeque::new()),
                max_replay_packets: options.max_replay_packets,
                last_replay_sequence: AtomicU64::new(0),
                last_activity: Mutex::new(Instant::now()),
                heartbeat_responder: options.heartbeat_responder,
            }),
        }
    }
    pub fn id(&self) -> u64 {
        self.inner.id
    }
    pub fn session_id(&self) -> &str {
        &self.inner.session_id
    }
    pub fn inbound_packets(&self) -> &PacketRegistry {
        &self.inner.inbound_packets
    }
    pub fn outbound_packets(&self) -> &PacketRegistry {
        &self.inner.outbound_packets
    }

    /// Stores application state without mixing it with transport internals.
    pub async fn set_state(&self, key: impl Into<String>, value: Value) {
        self.inner.state.write().await.insert(key.into(), value);
    }
    pub async fn state(&self, key: &str) -> Option<Value> {
        self.inner.state.read().await.get(key).cloned()
    }
    pub fn is_closed(&self) -> bool {
        *self.inner.closed.borrow()
    }
    pub async fn wait_closed(&self) {
        let mut closed = self.inner.closed.clone();
        if !*closed.borrow() {
            let _ = closed.changed().await;
        }
    }
    pub(crate) async fn last_activity(&self) -> Instant {
        *self.inner.last_activity.lock().await
    }
    pub fn recovery_checkpoint(&self) -> u64 {
        self.inner.last_replay_sequence.load(Ordering::Relaxed)
    }
    pub(crate) async fn replay_snapshot(&self) -> Vec<(u64, Vec<u8>)> {
        self.inner
            .replay_frames
            .lock()
            .await
            .iter()
            .cloned()
            .collect()
    }
    pub(crate) async fn restore_replay(&self, frames: Vec<(u64, Vec<u8>)>) {
        let sequence = frames.last().map_or(0, |(sequence, _)| *sequence);
        self.inner
            .replay_sequence
            .store(sequence, Ordering::Relaxed);
        *self.inner.replay_frames.lock().await = frames.into();
    }
    pub(crate) async fn replace_state(&self, state: serde_json::Map<String, Value>) {
        *self.inner.state.write().await = state;
    }
    pub(crate) async fn state_snapshot(&self) -> serde_json::Map<String, Value> {
        self.inner.state.read().await.clone()
    }
    pub async fn enable_packet(&self, tag: &str) -> Result<()> {
        let key = self
            .inner
            .inbound_packets
            .key(tag)
            .ok_or_else(|| Error::UnknownPacket(tag.into()))?;
        self.inner.enabled_packets.write().await.insert(key);
        Ok(())
    }
    pub async fn disable_packet(&self, tag: &str) -> Result<()> {
        let key = self
            .inner
            .inbound_packets
            .key(tag)
            .ok_or_else(|| Error::UnknownPacket(tag.into()))?;
        self.inner.enabled_packets.write().await.remove(&key);
        Ok(())
    }

    /// Encodes and sends a negotiated packet.
    pub async fn send(&self, tag: &str, value: &SonicValue) -> Result<()> {
        let key = self
            .inner
            .outbound_packets
            .key(tag)
            .ok_or_else(|| Error::UnknownPacket(tag.into()))?;
        let packet = self
            .inner
            .outbound_packets
            .by_key(key)
            .expect("registry key is valid");
        if packet.definition.schema.data_batching != 0 {
            return Err(Error::Value(format!(
                "packet \"{tag}\" is batched; use send_batch"
            )));
        }
        let payload = if packet.definition.schema.rereference {
            let mut previous = self.inner.last_sent.lock().await;
            if previous.get(&key) == Some(value) {
                Vec::new()
            } else {
                previous.insert(key, value.clone());
                packet.encode(value, self.id())?
            }
        } else {
            packet.encode(value, self.id())?
        };
        let mut frame = Vec::with_capacity(payload.len() + 1);
        frame.push(key);
        frame.extend(payload);
        if packet.replay {
            let sequence = self.inner.replay_sequence.fetch_add(1, Ordering::Relaxed) + 1;
            frame = control::encode(&control::Control::Replay {
                sequence,
                payload: frame,
            })?;
            let mut replay = self.inner.replay_frames.lock().await;
            replay.push_back((sequence, frame.clone()));
            while replay.len() > self.inner.max_replay_packets {
                replay.pop_front();
            }
        }
        self.send_frame(frame).await
    }

    pub async fn send_permutation_flags(
        &self,
        parent: &str,
        flags: &[bool],
        value: &SonicValue,
    ) -> Result<()> {
        let tag = self
            .inner
            .outbound_packets
            .permutation_tag_flags(parent, flags)?;
        self.send(&tag, value).await
    }

    pub async fn send_permutation_map(
        &self,
        parent: &str,
        flags: &HashMap<String, bool>,
        value: &SonicValue,
    ) -> Result<()> {
        let tag = self
            .inner
            .outbound_packets
            .permutation_tag_map(parent, flags)?;
        self.send(&tag, value).await
    }

    /// Encodes several values into one packet batch and sends one frame.
    pub async fn send_batch(&self, tag: &str, values: &[SonicValue]) -> Result<()> {
        let key = self
            .inner
            .outbound_packets
            .key(tag)
            .ok_or_else(|| Error::UnknownPacket(tag.into()))?;
        let packet = self
            .inner
            .outbound_packets
            .by_key(key)
            .expect("registry key is valid");
        if packet.definition.schema.data_batching == 0 {
            return Err(Error::Value(format!(
                "packet \"{tag}\" is not configured for batching"
            )));
        }
        if packet.definition.schema.max_batch_size > 0
            && values.len() > packet.definition.schema.max_batch_size as usize
        {
            return Err(Error::Value("batch exceeds max_batch_size".into()));
        }
        let payloads = values
            .iter()
            .map(|value| packet.encode(value, self.id()))
            .collect::<Result<Vec<_>>>()?;
        let payload = batching::encode::encode_for_packet(&packet.definition, &payloads)?;
        let mut frame = Vec::with_capacity(payload.len() + 1);
        frame.push(key);
        frame.extend(payload);
        self.send_frame(frame).await
    }

    /// Sends an RPC request frame. Responses arrive through [`recv`](Self::recv).
    pub async fn request(&self, tag: &str, value: &SonicValue) -> Result<u64> {
        let key = self
            .inner
            .outbound_packets
            .key(tag)
            .ok_or_else(|| Error::UnknownPacket(tag.into()))?;
        let packet = self
            .inner
            .outbound_packets
            .by_key(key)
            .expect("registry key is valid");
        let payload = packet.encode(value, self.id())?;
        let id = self.inner.request_id.fetch_add(1, Ordering::Relaxed);
        self.send_frame(control::encode(&control::Control::Request {
            id,
            packet_key: key,
            payload,
        })?)
        .await?;
        Ok(id)
    }

    pub async fn respond(&self, id: u64, result: std::result::Result<Value, Value>) -> Result<()> {
        let (ok, value) = match result {
            Ok(value) => (true, value),
            Err(value) => (false, value),
        };
        self.send_frame(control::encode(&control::Control::Response {
            id,
            ok,
            value,
        })?)
        .await
    }

    /// Receives and validates the next packet or control message.
    pub async fn recv(&self) -> Result<Option<Incoming>> {
        let result = self.recv_inner().await;
        if result.is_err() {
            let _ = self.close().await;
        }
        result
    }

    async fn recv_inner(&self) -> Result<Option<Incoming>> {
        if let Some(message) = self.inner.decoded.lock().await.pop_front() {
            return Ok(Some(message));
        }
        loop {
            let Some(frame) = self.inner.reader.lock().await.recv().await else {
                return Ok(None);
            };
            let frame = frame?;
            *self.inner.last_activity.lock().await = Instant::now();
            if frame.is_empty() {
                return Err(Error::Protocol("empty WebSocket message".into()));
            }
            if frame[0] == control::KEY {
                if !self.inner.rate_state.lock().await.allow(
                    self.inner.inbound_rate_limit,
                    control::KEY,
                    0,
                    1,
                ) {
                    return Err(Error::Protocol("connection exceeded its rate limit".into()));
                }
                if let Some(message) = self.decode_control(&frame)? {
                    return Ok(Some(message));
                }
                continue;
            }
            let key = frame[0];
            let packet = self
                .inner
                .inbound_packets
                .by_key(key)
                .ok_or(Error::UnknownKey(key))?;
            if !self.inner.enabled_packets.read().await.contains(&key) {
                return Err(Error::Protocol(format!(
                    "packet \"{}\" is disabled",
                    packet.definition.tag
                )));
            }
            if packet.definition.schema.rereference && frame.len() == 1 {
                let value = self
                    .inner
                    .last_received
                    .lock()
                    .await
                    .get(&key)
                    .cloned()
                    .ok_or_else(|| {
                        Error::Protocol(format!(
                            "packet \"{}\" has no previous value to rereference",
                            packet.definition.tag
                        ))
                    })?;
                return Ok(Some(Incoming::Event(event(packet, value))));
            }
            if packet.definition.schema.data_batching != 0 {
                let payloads =
                    batching::decode::decode_for_packet(&packet.definition, &frame[1..])?;
                let amount = u32::try_from(payloads.len()).unwrap_or(u32::MAX);
                if !self.inner.rate_state.lock().await.allow(
                    self.inner.inbound_rate_limit,
                    key,
                    packet.rate_limit,
                    amount,
                ) {
                    return Err(Error::Protocol(format!(
                        "packet \"{}\" exceeded its rate limit",
                        packet.definition.tag
                    )));
                }
                let mut messages = payloads
                    .into_iter()
                    .map(|payload| packet.decode(&payload).map(|value| event(packet, value)))
                    .collect::<Result<VecDeque<_>>>()?;
                let first = messages.pop_front();
                self.inner
                    .decoded
                    .lock()
                    .await
                    .extend(messages.into_iter().map(Incoming::Event));
                return Ok(first.map(Incoming::Event));
            }
            if !self.inner.rate_state.lock().await.allow(
                self.inner.inbound_rate_limit,
                key,
                packet.rate_limit,
                1,
            ) {
                return Err(Error::Protocol(format!(
                    "packet \"{}\" exceeded its rate limit",
                    packet.definition.tag
                )));
            }
            let value = packet.decode(&frame[1..])?;
            if packet.definition.schema.rereference {
                self.inner
                    .last_received
                    .lock()
                    .await
                    .insert(key, value.clone());
            }
            return Ok(Some(Incoming::Event(event(packet, value))));
        }
    }

    pub async fn close(&self) -> Result<()> {
        self.inner
            .writer
            .send(Message::Close(None))
            .await
            .map_err(|_| Error::Protocol("connection writer stopped".into()))
    }
    pub(crate) async fn send_frame(&self, frame: Vec<u8>) -> Result<()> {
        self.inner
            .writer
            .send(Message::Binary(frame))
            .await
            .map_err(|_| Error::Protocol("connection writer stopped".into()))
    }

    fn decode_control(&self, frame: &[u8]) -> Result<Option<Incoming>> {
        Ok(Some(match control::decode(frame)? {
            control::Control::Heartbeat => {
                if self.inner.heartbeat_responder {
                    self.inner
                        .writer
                        .try_send(Message::Binary(vec![control::KEY]))
                        .map_err(|_| Error::Protocol("connection writer stopped".into()))?;
                }
                return Ok(None);
            }
            control::Control::Request {
                id,
                packet_key,
                payload,
            } => {
                let packet = self
                    .inner
                    .inbound_packets
                    .by_key(packet_key)
                    .ok_or(Error::UnknownKey(packet_key))?;
                Incoming::Request(Request {
                    id,
                    packet_key,
                    event: event(packet, packet.decode(&payload)?),
                })
            }
            control::Control::Response { id, ok, value } => Incoming::Response {
                id,
                result: if ok {
                    Ok(value)
                } else {
                    Err(value.to_string())
                },
            },
            control::Control::Replay { sequence, payload } => {
                self.inner
                    .last_replay_sequence
                    .store(sequence, Ordering::Relaxed);
                if payload.first() == Some(&control::KEY) {
                    return self.decode_control(&payload);
                }
                let key = *payload
                    .first()
                    .ok_or_else(|| Error::Protocol("empty replay payload".into()))?;
                let packet = self
                    .inner
                    .inbound_packets
                    .by_key(key)
                    .ok_or(Error::UnknownKey(key))?;
                Incoming::Event(event(packet, packet.decode(&payload[1..])?))
            }
            control::Control::Resumed {
                recovered,
                replayed,
            } => Incoming::Recovery {
                recovered,
                replayed,
            },
            control::Control::Resume {
                session_id,
                last_sequence,
            } => Incoming::Resume {
                session_id,
                last_sequence,
            },
        }))
    }
}

fn event(packet: &crate::Packet, value: SonicValue) -> Event {
    let permutation = packet.group.as_ref().and_then(|group| {
        group.permutation.as_ref().map(|values| {
            let enabled = group.variant.split(',').collect::<HashSet<_>>();
            values
                .iter()
                .map(|value| (value.clone(), enabled.contains(value.as_str())))
                .collect()
        })
    });
    Event {
        tag: packet.definition.tag.clone(),
        value,
        parent: packet.group.as_ref().map(|group| group.parent.clone()),
        variant: packet.group.as_ref().map(|group| group.variant.clone()),
        permutation,
    }
}

/// A connected SonicWS client.
pub struct Client;

#[derive(Debug, Clone)]
pub struct ClientConfig {
    pub inbound_rate_limit: u32,
    pub max_message_size: usize,
}

#[derive(Debug, Clone)]
pub struct ReconnectConfig {
    pub attempts: usize,
    pub min_delay: Duration,
    pub max_delay: Duration,
}

impl Default for ReconnectConfig {
    fn default() -> Self {
        Self {
            attempts: usize::MAX,
            min_delay: Duration::from_millis(500),
            max_delay: Duration::from_secs(10),
        }
    }
}

impl Default for ClientConfig {
    fn default() -> Self {
        Self {
            inbound_rate_limit: 500,
            max_message_size: 8 * 1024 * 1024,
        }
    }
}

impl Client {
    /// Connects, verifies protocol v25, and completes schema negotiation.
    pub async fn connect(url: impl AsRef<str>) -> Result<Connection> {
        Self::connect_with_config(url, ClientConfig::default()).await
    }

    pub async fn connect_with_config(
        url: impl AsRef<str>,
        config: ClientConfig,
    ) -> Result<Connection> {
        if config.max_message_size == 0 {
            return Err(Error::Protocol("max_message_size must be positive".into()));
        }
        let (mut socket, _) = connect_async(url.as_ref()).await?;
        let first = socket
            .next()
            .await
            .ok_or_else(|| Error::Protocol("server closed before handshake".into()))??;
        let bytes = match first {
            Message::Binary(bytes) => bytes,
            _ => return Err(Error::Protocol("handshake must be binary".into())),
        };
        if bytes.len() > config.max_message_size {
            return Err(Error::Protocol(
                "schema handshake exceeds max_message_size".into(),
            ));
        }
        let (id, session_id, outbound, inbound) = parse_handshake(&bytes)?;
        let transport = bridge(socket, config.max_message_size);
        Ok(Connection::new(
            id,
            session_id,
            inbound,
            outbound,
            transport,
            ConnectionOptions {
                inbound_rate_limit: config.inbound_rate_limit,
                max_replay_packets: 0,
                heartbeat_responder: true,
            },
        ))
    }

    /// Opens a replacement transport and requests state/replay recovery.
    pub async fn resume(
        url: impl AsRef<str>,
        previous_session_id: impl Into<String>,
        last_sequence: u64,
    ) -> Result<Connection> {
        let connection = Self::connect(url).await?;
        connection
            .send_frame(control::encode(&control::Control::Resume {
                session_id: previous_session_id.into(),
                last_sequence,
            })?)
            .await?;
        Ok(connection)
    }

    /// Retries a replacement connection with bounded exponential backoff.
    pub async fn reconnect(
        url: impl AsRef<str>,
        previous_session_id: impl Into<String>,
        last_sequence: u64,
        config: ReconnectConfig,
    ) -> Result<Connection> {
        if config.attempts == 0 || config.max_delay < config.min_delay {
            return Err(Error::Protocol("invalid reconnect configuration".into()));
        }
        let url = url.as_ref().to_owned();
        let session = previous_session_id.into();
        let mut delay = config.min_delay;
        let mut last_error = None;
        for attempt in 0..config.attempts {
            match Self::resume(&url, session.clone(), last_sequence).await {
                Ok(connection) => return Ok(connection),
                Err(error) => last_error = Some(error),
            }
            if attempt + 1 < config.attempts {
                tokio::time::sleep(delay).await;
                delay = delay.saturating_mul(2).min(config.max_delay);
            }
        }
        Err(last_error.unwrap_or_else(|| Error::Protocol("reconnect failed".into())))
    }
}

pub(crate) fn bridge<S>(socket: S, max_message_size: usize) -> TransportParts
where
    S: Stream<Item = std::result::Result<Message, tokio_tungstenite::tungstenite::Error>>
        + Sink<Message, Error = tokio_tungstenite::tungstenite::Error>
        + Send
        + Unpin
        + 'static,
{
    let (mut sink, mut stream) = socket.split();
    let (write_tx, mut write_rx) = mpsc::channel::<Message>(128);
    let (read_tx, read_rx) = mpsc::channel::<Result<Vec<u8>>>(128);
    let (closed_tx, closed_rx) = watch::channel(false);
    tokio::spawn(async move {
        while let Some(message) = write_rx.recv().await {
            if sink.send(message).await.is_err() {
                break;
            }
        }
    });
    tokio::spawn(async move {
        while let Some(message) = stream.next().await {
            let value = match message {
                Ok(Message::Binary(bytes)) if bytes.len() <= max_message_size => Ok(bytes.to_vec()),
                Ok(Message::Binary(_)) => Err(Error::Protocol(
                    "WebSocket message exceeds max_message_size".into(),
                )),
                Ok(Message::Close(_)) => break,
                Ok(_) => continue,
                Err(error) => Err(error.into()),
            };
            if read_tx.send(value).await.is_err() {
                break;
            }
        }
        let _ = closed_tx.send(true);
    });
    TransportParts {
        writer: write_tx,
        reader: read_rx,
        closed: closed_rx,
    }
}

fn parse_handshake(bytes: &[u8]) -> Result<(u64, String, PacketRegistry, PacketRegistry)> {
    if bytes.len() < 4 || &bytes[..3] != b"SWS" {
        return Err(Error::Protocol("server does not use SonicWS".into()));
    }
    if bytes[3] != PROTOCOL_VERSION {
        return Err(Error::Protocol(format!(
            "protocol mismatch: server {}, Rust client {}",
            bytes[3], PROTOCOL_VERSION
        )));
    }
    let data = sonic_ws_core::compression::gzip::decompress(&bytes[4..])?;
    let mut cursor = HandshakeCursor {
        bytes: &data,
        offset: 0,
    };
    let id = cursor.varint()?;
    let session_length = cursor.varint_usize()?;
    let session_id = String::from_utf8(cursor.take(session_length)?.to_vec())
        .map_err(|_| Error::Protocol("session id is not UTF-8".into()))?;
    let client_length = cursor.varint_usize()?;
    let client_packets = PacketRegistry::deserialize(cursor.take(client_length)?)?;
    let server_packets = PacketRegistry::deserialize(cursor.rest())?;
    Ok((id, session_id, client_packets, server_packets))
}

pub(crate) fn write_varint(mut value: u64, output: &mut Vec<u8>) {
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
struct HandshakeCursor<'a> {
    bytes: &'a [u8],
    offset: usize,
}
impl<'a> HandshakeCursor<'a> {
    fn take(&mut self, length: usize) -> Result<&'a [u8]> {
        let end = self
            .offset
            .checked_add(length)
            .ok_or_else(|| Error::Protocol("handshake length overflow".into()))?;
        if end > self.bytes.len() {
            return Err(Error::Protocol("truncated handshake".into()));
        }
        let value = &self.bytes[self.offset..end];
        self.offset = end;
        Ok(value)
    }
    fn byte(&mut self) -> Result<u8> {
        Ok(self.take(1)?[0])
    }
    fn varint(&mut self) -> Result<u64> {
        let mut value = 0;
        for shift in (0..=63).step_by(7) {
            let byte = self.byte()?;
            value |= u64::from(byte & 0x7f) << shift;
            if byte & 0x80 == 0 {
                return Ok(value);
            }
        }
        Err(Error::Protocol(
            "handshake variable integer is too long".into(),
        ))
    }
    fn varint_usize(&mut self) -> Result<usize> {
        usize::try_from(self.varint()?)
            .map_err(|_| Error::Protocol("handshake length exceeds platform".into()))
    }
    fn rest(&self) -> &'a [u8] {
        &self.bytes[self.offset..]
    }
}
