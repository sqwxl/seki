use std::sync::Arc;
use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use rustls::client::danger::{HandshakeSignatureValid, ServerCertVerified, ServerCertVerifier};
use rustls::crypto::ring;
use rustls::pki_types::{CertificateDer, ServerName, UnixTime};
use rustls::{ClientConfig, DigitallySignedStruct, SignatureScheme};
use seki_api_types::ws::ServerMsg;
use tokio::sync::mpsc;
use tokio_tungstenite::{Connector, connect_async_tls_with_config, tungstenite::Message};
use tracing::{error, info, warn};

use crate::config::Config;

#[derive(Debug)]
struct NoCertVerifier;

impl ServerCertVerifier for NoCertVerifier {
    fn verify_server_cert(
        &self,
        _end_entity: &CertificateDer<'_>,
        _intermediates: &[CertificateDer<'_>],
        _server_name: &ServerName<'_>,
        _ocsp_response: &[u8],
        _now: UnixTime,
    ) -> Result<ServerCertVerified, rustls::Error> {
        Ok(ServerCertVerified::assertion())
    }

    fn verify_tls12_signature(
        &self,
        _message: &[u8],
        _cert: &CertificateDer<'_>,
        _dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        Ok(HandshakeSignatureValid::assertion())
    }

    fn verify_tls13_signature(
        &self,
        _message: &[u8],
        _cert: &CertificateDer<'_>,
        _dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        Ok(HandshakeSignatureValid::assertion())
    }

    fn supported_verify_schemes(&self) -> Vec<SignatureScheme> {
        vec![
            SignatureScheme::RSA_PKCS1_SHA256,
            SignatureScheme::RSA_PKCS1_SHA384,
            SignatureScheme::RSA_PKCS1_SHA512,
            SignatureScheme::ECDSA_NISTP256_SHA256,
            SignatureScheme::ECDSA_NISTP384_SHA384,
            SignatureScheme::ECDSA_NISTP521_SHA512,
            SignatureScheme::RSA_PSS_SHA256,
            SignatureScheme::RSA_PSS_SHA384,
            SignatureScheme::RSA_PSS_SHA512,
            SignatureScheme::ED25519,
        ]
    }
}

fn tls_connector() -> Connector {
    let config = ClientConfig::builder_with_provider(ring::default_provider().into())
        .with_safe_default_protocol_versions()
        .expect("valid protocol versions")
        .dangerous()
        .with_custom_certificate_verifier(Arc::new(NoCertVerifier))
        .with_no_client_auth();
    Connector::Rustls(Arc::new(config))
}

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
    info!("[ws] connecting to {ws_url}");
    let (ws_stream, _) = connect_async_tls_with_config(ws_url, None, false, Some(tls_connector()))
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
                        warn!("[ws] failed to parse message: {e}");
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
                error!("[ws] connection failed, retrying in {delay:?}: {e}");
                tokio::time::sleep(delay).await;
                delay = (delay * 2).min(Duration::from_secs(30));
            }
        }
    }
}
