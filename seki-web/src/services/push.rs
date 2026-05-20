use serde::Serialize;
use web_push::{
    ContentEncoding, HyperWebPushClient, SubscriptionInfo, VapidSignatureBuilder, WebPushClient,
    WebPushMessageBuilder,
};

use crate::error::AppError;
use crate::models::push_destination::PushDestination;

#[derive(Debug, Serialize)]
pub struct PushPayload {
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub body: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub icon: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub badge: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<PushNotificationData>,
}

#[derive(Debug, Serialize)]
pub struct PushNotificationData {
    #[serde(rename = "type")]
    pub event_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub game_id: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
}

pub struct PushService {
    partial_builder: web_push::PartialVapidSignatureBuilder,
}

impl PushService {
    pub fn new(private_key: &str) -> Result<Self, AppError> {
        let builder = VapidSignatureBuilder::from_base64_no_sub(private_key)
            .map_err(|e| AppError::Internal(format!("VAPID key error: {e}")))?;
        Ok(Self {
            partial_builder: builder,
        })
    }

    pub fn get_public_key(&self) -> Vec<u8> {
        self.partial_builder.get_public_key()
    }

    pub async fn send(
        &self,
        destination: &PushDestination,
        payload: &PushPayload,
    ) -> Result<(), AppError> {
        let subscription = SubscriptionInfo::new(
            &destination.endpoint,
            &destination.p256dh,
            &destination.auth,
        );

        let content = serde_json::to_string(payload)
            .map_err(|e| AppError::Internal(format!("Push payload serialization error: {e}")))?;

        let sig = self
            .partial_builder
            .clone()
            .add_sub_info(&subscription)
            .build()
            .map_err(|e| AppError::Internal(format!("VAPID signature error: {e}")))?;

        let mut message_builder = WebPushMessageBuilder::new(&subscription);
        message_builder.set_payload(ContentEncoding::Aes128Gcm, content.as_bytes());
        message_builder.set_vapid_signature(sig);

        let message = message_builder
            .build()
            .map_err(|e| AppError::Internal(format!("Push message build error: {e}")))?;

        let client = HyperWebPushClient::new();

        client.send(message).await.map_err(|e| {
            let reason = format!("{e}");
            AppError::Internal(format!("Push send error: {reason}"))
        })?;

        Ok(())
    }

    pub async fn send_to_user(
        &self,
        db: &crate::db::DbPool,
        user_id: i64,
        payload: &PushPayload,
    ) -> Result<(), AppError> {
        let destinations = PushDestination::find_by_user_and_enabled(db, user_id)
            .await
            .map_err(AppError::Database)?;

        for destination in &destinations {
            let result = self.send(destination, payload).await;
            match result {
                Ok(()) => {
                    PushDestination::record_delivery(db, destination.id)
                        .await
                        .ok();
                }
                Err(e) => {
                    let reason = format!("{e}");
                    PushDestination::record_failure(db, destination.id, &reason)
                        .await
                        .ok();
                    if reason.contains("410") {
                        tracing::info!(
                            "push: disabling expired destination {} for user {}",
                            destination.id,
                            user_id
                        );
                        PushDestination::disable(db, destination.id).await.ok();
                    }
                }
            }
        }

        Ok(())
    }
}
