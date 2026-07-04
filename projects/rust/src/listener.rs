use std::{
    collections::HashMap,
    future::Future,
    pin::Pin,
    sync::{Arc, RwLock},
};

use crate::{Connection, Event, Incoming, Result};

type HandlerFuture = Pin<Box<dyn Future<Output = ()> + Send + 'static>>;
type Handler = Arc<dyn Fn(Connection, Event) -> HandlerFuture + Send + Sync + 'static>;
type ConnectHandler = Arc<dyn Fn(Connection) -> HandlerFuture + Send + Sync + 'static>;

/// Async packet listeners for a client or an individual server connection.
#[derive(Clone, Default)]
pub struct Listeners {
    handlers: Arc<RwLock<HashMap<String, Vec<Handler>>>>,
    connect_handlers: Arc<RwLock<Vec<ConnectHandler>>>,
}

impl Listeners {
    pub fn new() -> Self {
        Self::default()
    }

    /// Registers an async packet handler that only needs the decoded event.
    pub fn on<F, Fut>(&self, tag: impl Into<String>, handler: F)
    where
        F: Fn(Event) -> Fut + Send + Sync + 'static,
        Fut: Future<Output = ()> + Send + 'static,
    {
        self.on_with_connection(tag, move |_, event| handler(event));
    }

    /// Registers an async packet handler with access to its connection.
    pub fn on_with_connection<F, Fut>(&self, tag: impl Into<String>, handler: F)
    where
        F: Fn(Connection, Event) -> Fut + Send + Sync + 'static,
        Fut: Future<Output = ()> + Send + 'static,
    {
        self.handlers
            .write()
            .expect("listener registry poisoned")
            .entry(tag.into())
            .or_default()
            .push(Arc::new(move |connection, event| {
                Box::pin(handler(connection, event))
            }));
    }

    pub fn on_connect<F, Fut>(&self, handler: F)
    where
        F: Fn(Connection) -> Fut + Send + Sync + 'static,
        Fut: Future<Output = ()> + Send + 'static,
    {
        self.connect_handlers
            .write()
            .expect("listener registry poisoned")
            .push(Arc::new(move |connection| Box::pin(handler(connection))));
    }

    pub(crate) async fn connected(&self, connection: Connection) {
        let handlers = self
            .connect_handlers
            .read()
            .expect("listener registry poisoned")
            .clone();
        for handler in handlers {
            handler(connection.clone()).await;
        }
    }

    pub(crate) async fn dispatch(&self, connection: Connection, event: Event) {
        let mut tags = vec![event.tag.clone()];
        if let Some(parent) = &event.parent
            && parent != &event.tag
        {
            tags.push(parent.clone());
        }
        for tag in tags {
            let handlers = self
                .handlers
                .read()
                .expect("listener registry poisoned")
                .get(&tag)
                .cloned()
                .unwrap_or_default();
            for handler in handlers {
                handler(connection.clone(), event.clone()).await;
            }
        }
    }

    /// Runs listener dispatch for a client or manually accepted connection.
    pub async fn run(&self, connection: Connection) -> Result<()> {
        self.connected(connection.clone()).await;
        while let Some(message) = connection.recv().await? {
            if let Incoming::Event(event) = message {
                self.dispatch(connection.clone(), event).await;
            }
        }
        Ok(())
    }
}
