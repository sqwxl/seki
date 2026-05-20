use reqwest::Client;

use crate::error::AppError;
use crate::models::fcm_token::FcmToken;

#[derive(Debug)]
pub struct FcmPayload {
    pub title: String,
    pub body: Option<String>,
    pub url: Option<String>,
}

pub struct FcmService {
    client: Client,
    server_key: String,
}

impl FcmService {
    pub fn new(server_key: &str) -> Self {
        Self {
            client: Client::new(),
            server_key: server_key.to_string(),
        }
    }

    pub fn from_env() -> Result<Self, AppError> {
        let key = std::env::var("FCM_SERVER_KEY")
            .map_err(|_| AppError::Internal("FCM_SERVER_KEY not set".into()))?;
        Ok(Self::new(&key))
    }

    pub async fn send(&self, token: &str, payload: &FcmPayload) -> Result<(), AppError> {
        let mut body = serde_json::json!({
            "to": token,
            "notification": {
                "title": payload.title,
                "body": payload.body,
                "click_action": "OPEN_ACTIVITY",
                "sound": "default",
            },
            "priority": "high",
        });

        if let Some(url) = &payload.url {
            body["data"] = serde_json::json!({ "url": url });
        }

        let response = self
            .client
            .post("https://fcm.googleapis.com/fcm/send")
            .header("Authorization", format!("key={}", self.server_key))
            .header("Content-Type", "application/json")
            .json(&body)
            .send()
            .await
            .map_err(|e| AppError::Internal(format!("FCM send error: {e}")))?;

        if !response.status().is_success() {
            let status = response.status();
            let text = response
                .text()
                .await
                .unwrap_or_else(|_| "unknown".to_string());
            tracing::warn!("FCM send failed (HTTP {status}): {text}");
        }

        Ok(())
    }

    pub async fn send_to_user(
        &self,
        db: &crate::db::DbPool,
        user_id: i64,
        payload: &FcmPayload,
    ) -> Result<(), AppError> {
        let tokens = FcmToken::find_by_user_and_enabled(db, user_id)
            .await
            .map_err(AppError::Database)?;

        for fcm_token in &tokens {
            match self.send(&fcm_token.token, payload).await {
                Ok(()) => tracing::info!(
                    "fcm: delivered to user {} token {}",
                    user_id,
                    &fcm_token.token[..8]
                ),
                Err(e) => tracing::error!("fcm: failed to send to user {}: {e}", user_id),
            }
        }

        Ok(())
    }
}
