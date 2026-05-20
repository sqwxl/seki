use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use seki_api_types::ws::ServerMsg;
use tokio::sync::mpsc;
use tokio_tungstenite::{connect_async, tungstenite::Message};
use tracing::{error, info, warn};

use crate::config::Config;

pub struct WsHandle {
    pub tx: mpsc::UnboundedSender<String>,
    pub rx: mpsc::UnboundedReceiver<ServerMsg>,
}

pub async fn connect(config: &Config) -> Result<WsHandle, String> {
    let ws_url = format!(
        "{}/ws?token={}",
        config
            .server_url
            .trim_end_matches('/')
            .replace("http://", "ws://")
            .replace("https://", "wss://"),
        config.api_token
    );

    connect_inner(&ws_url).await
}

async fn connect_inner(ws_url: &str) -> Result<WsHandle, String> {
    info!("Connecting to {ws_url}");
    let (ws_stream, _) = connect_async(ws_url)
        .await
        .map_err(|e| format!("Failed to connect: {e}"))?;

    let (mut write, mut read) = ws_stream.split();

    let (msg_tx, mut msg_rx): (mpsc::UnboundedSender<String>, _) = mpsc::unbounded_channel();
    let (server_tx, server_rx): (mpsc::UnboundedSender<ServerMsg>, _) = mpsc::unbounded_channel();

    let _write_task = tokio::spawn(async move {
        while let Some(msg) = msg_rx.recv().await {
            if write.send(Message::Text(msg)).await.is_err() {
                break;
            }
        }
    });

    let server_tx_clone = server_tx.clone();
    let _read_task = tokio::spawn(async move {
        while let Some(Ok(msg)) = read.next().await {
            match msg {
                Message::Text(text) => match serde_json::from_str::<ServerMsg>(&text) {
                    Ok(server_msg) => {
                        if server_tx_clone.send(server_msg).is_err() {
                            break;
                        }
                    }
                    Err(e) => {
                        warn!("Failed to parse server message: {e}: {text}");
                    }
                },
                Message::Close(_) => break,
                Message::Ping(data) => {
                    // pong handled by tungstenite internally
                    let _ = data;
                }
                _ => {}
            }
        }
    });

    let handle = WsHandle {
        tx: msg_tx,
        rx: server_rx,
    };

    Ok(handle)
}

/// Connect with automatic reconnection on failure.
pub async fn connect_with_retry(config: &Config) -> WsHandle {
    let ws_url = format!(
        "{}/ws?token={}",
        config
            .server_url
            .trim_end_matches('/')
            .replace("http://", "ws://")
            .replace("https://", "wss://"),
        config.api_token
    );

    let mut delay = Duration::from_secs(1);
    loop {
        match connect_inner(&ws_url).await {
            Ok(handle) => return handle,
            Err(e) => {
                error!("Connection failed (retrying in {delay:?}): {e}");
                tokio::time::sleep(delay).await;
                delay = (delay * 2).min(Duration::from_secs(30));
            }
        }
    }
}
