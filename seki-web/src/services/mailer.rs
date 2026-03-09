use std::sync::Arc;

use lettre::message::Mailbox;
use lettre::transport::smtp::authentication::Credentials;
use lettre::{AsyncSmtpTransport, AsyncTransport, Message, Tokio1Executor};

#[derive(Clone)]
pub struct Mailer {
    transport: Option<Arc<AsyncSmtpTransport<Tokio1Executor>>>,
    from: String,
}

impl Mailer {
    pub fn from_env() -> Self {
        let host = match std::env::var("SMTP_HOST") {
            Ok(h) if !h.is_empty() => h,
            _ => {
                tracing::warn!("SMTP_HOST not set — email sending disabled");
                return Self {
                    transport: None,
                    from: String::new(),
                };
            }
        };

        let port: u16 = std::env::var("SMTP_PORT")
            .ok()
            .and_then(|p| p.parse().ok())
            .unwrap_or(587);

        let from = std::env::var("SMTP_FROM").unwrap_or_else(|_| "noreply@seki.local".into());

        let username = std::env::var("SMTP_USERNAME").ok();
        let password = std::env::var("SMTP_PASSWORD").ok();

        let transport = match (username, password) {
            (Some(u), Some(p)) => AsyncSmtpTransport::<Tokio1Executor>::starttls_relay(&host)
                .expect("Failed to create SMTP transport")
                .port(port)
                .credentials(Credentials::new(u, p))
                .build(),
            _ => AsyncSmtpTransport::<Tokio1Executor>::builder_dangerous(&host)
                .port(port)
                .build(),
        };

        tracing::info!("Email sending enabled via {host}:{port}");

        Self {
            transport: Some(Arc::new(transport)),
            from,
        }
    }

    pub async fn send_invitation(
        &self,
        to: &str,
        game_id: i64,
        invite_token: &str,
        base_url: &str,
    ) {
        let transport = match &self.transport {
            Some(t) => t,
            None => {
                tracing::warn!("Skipping invitation email (SMTP not configured)");
                return;
            }
        };

        let from: Mailbox = match self.from.parse() {
            Ok(m) => m,
            Err(e) => {
                tracing::error!("Invalid SMTP_FROM address '{}': {e}", self.from);
                return;
            }
        };

        let to_mailbox: Mailbox = match to.parse() {
            Ok(m) => m,
            Err(e) => {
                tracing::error!("Invalid recipient address '{to}': {e}");
                return;
            }
        };

        let link = format!("{base_url}/games/{game_id}?token={invite_token}");

        let body = format!(
            "You've been invited to a game of Go on Seki!\n\n\
             Click the link below to join:\n\
             {link}\n\n\
             If you didn't expect this email, you can safely ignore it."
        );

        let message = match Message::builder()
            .from(from)
            .to(to_mailbox)
            .subject("You've been invited to a game on Seki")
            .body(body)
        {
            Ok(m) => m,
            Err(e) => {
                tracing::error!("Failed to build invitation email: {e}");
                return;
            }
        };

        if let Err(e) = transport.send(message).await {
            tracing::error!("Failed to send invitation email to {to}: {e}");
        } else {
            tracing::info!("Invitation email sent to {to} for game {game_id}");
        }
    }
}
