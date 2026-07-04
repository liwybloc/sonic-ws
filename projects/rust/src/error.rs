use thiserror::Error;

/// Errors produced by packet configuration, codecs, and transports.
#[derive(Debug, Error)]
pub enum Error {
    #[error("invalid packet schema: {0}")]
    Schema(String),
    #[error("invalid SonicWS frame: {0}")]
    Protocol(String),
    #[error("packet \"{0}\" is not registered")]
    UnknownPacket(String),
    #[error("packet key {0} was not negotiated")]
    UnknownKey(u8),
    #[error("packet value is invalid: {0}")]
    Value(String),
    #[error("request {0} timed out")]
    RequestTimeout(u64),
    #[error("request failed: {0}")]
    Request(String),
    #[error(transparent)]
    Core(#[from] sonic_ws_core::Error),
    #[error(transparent)]
    WebSocket(Box<tokio_tungstenite::tungstenite::Error>),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
    #[error(transparent)]
    Io(#[from] std::io::Error),
}

pub type Result<T> = std::result::Result<T, Error>;

impl From<tokio_tungstenite::tungstenite::Error> for Error {
    fn from(error: tokio_tungstenite::tungstenite::Error) -> Self {
        Self::WebSocket(Box::new(error))
    }
}
