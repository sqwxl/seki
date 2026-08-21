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

    pub async fn send_password_reset(&self, to: &str, username: &str, reset_url: &str) {
        let transport = match &self.transport {
            Some(t) => t,
            None => {
                tracing::warn!("Skipping password reset email (SMTP not configured)");
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

        let body = format!(
            "Hi {username},\n\n\
             We received a request to reset your Seki password.\n\n\
             Click the link below to choose a new password:\n\
             {reset_url}\n\n\
             This link expires in 60 minutes and can only be used once.\n\n\
             If you didn't request this, you can safely ignore this email — your password won't change."
        );

        let message = match Message::builder()
            .from(from)
            .to(to_mailbox)
            .subject("Reset your Seki password")
            .body(body)
        {
            Ok(m) => m,
            Err(e) => {
                tracing::error!("Failed to build password reset email: {e}");
                return;
            }
        };

        if let Err(e) = transport.send(message).await {
            tracing::error!("Failed to send password reset email to {to}: {e}");
        } else {
            tracing::info!("Password reset email sent to {to}");
        }
    }

    pub async fn send_invitation(
        &self,
        to: &str,
        game_id: i64,
        token: &str,
        base_url: &str,
        creator_username: &str,
        message: Option<&str>,
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

        // Single-use login link; the token identifies the challengee server-side.
        let link = format!("{base_url}/invite/{token}");

        let message_body = match message {
            Some(msg) => format!("\n\n{creator_username} says: \"{msg}\"\n"),
            None => String::new(),
        };

        let body = format!(
            "{creator_username} has invited you to a game of Go on Seki!\n\n\
             Click the link below to join:\n\
             {link}\n\
             {message_body}\n\
             If you didn't expect this email, you can safely ignore it."
        );

        let subject = format!("{creator_username} is inviting you to a game of Go on Seki!");
        let email = match Message::builder()
            .from(from)
            .to(to_mailbox)
            .subject(subject)
            .body(body)
        {
            Ok(m) => m,
            Err(e) => {
                tracing::error!("Failed to build invitation email: {e}");
                return;
            }
        };

        if let Err(e) = transport.send(email).await {
            tracing::error!("Failed to send invitation email to {to}: {e}");
        } else {
            tracing::info!("Invitation email sent to {to} for game {game_id}");
        }
    }

    pub async fn send_turn_reminder(
        &self,
        to: &str,
        game_id: i64,
        opponent_username: &str,
        base_url: &str,
    ) {
        let transport = match &self.transport {
            Some(t) => t,
            None => {
                tracing::warn!("Skipping turn reminder email (SMTP not configured)");
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

        let link = format!("{base_url}/games/{game_id}");
        let subject = format!("Your go game against {opponent_username} — 12 hours left");
        let body = format!(
            "Heads up! You have ~12h left to make a move in your game against {opponent_username}.\n\n\
             Play here: {link}"
        );

        let email = match Message::builder()
            .from(from)
            .to(to_mailbox)
            .subject(subject)
            .body(body)
        {
            Ok(m) => m,
            Err(e) => {
                tracing::error!("Failed to build turn reminder email: {e}");
                return;
            }
        };

        if let Err(e) = transport.send(email).await {
            tracing::error!("Failed to send turn reminder email to {to}: {e}");
        } else {
            tracing::info!("Turn reminder email sent to {to} for game {game_id}");
        }
    }

    pub async fn send_email_confirmation(&self, to: &str, token: &str, base_url: &str) {
        let transport = match &self.transport {
            Some(t) => t,
            None => {
                tracing::warn!("Skipping email confirmation (SMTP not configured)");
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

        let link = format!("{base_url}/confirm-email?token={token}");
        let body = format!(
            "Confirm your email address for your Seki account.\n\n\
             Click the link below to confirm:\n\
             {link}\n\n\
             This link expires in 24 hours. If you didn't request this, you can safely ignore this email."
        );

        let email = match Message::builder()
            .from(from)
            .to(to_mailbox)
            .subject("Confirm your email address")
            .body(body)
        {
            Ok(m) => m,
            Err(e) => {
                tracing::error!("Failed to build email confirmation: {e}");
                return;
            }
        };

        if let Err(e) = transport.send(email).await {
            tracing::error!("Failed to send email confirmation to {to}: {e}");
        } else {
            tracing::info!("Email confirmation sent to {to}");
        }
    }
}
