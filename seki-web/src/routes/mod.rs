pub mod api;
pub mod auth;
pub mod games;
pub mod health;
pub mod settings;
pub mod spa;
pub mod users;
pub mod web_api;

use serde::Serialize;
use tower_sessions::Session;

const FLASH_KEY: &str = "flash";

pub(crate) fn wants_json(headers: &axum::http::HeaderMap) -> bool {
    headers
        .get(axum::http::header::ACCEPT)
        .and_then(|v| v.to_str().ok())
        .is_some_and(|s| s.contains("application/json"))
}

pub(crate) fn serialize_user_data(user: &crate::session::CurrentUser) -> String {
    serde_json::to_string(&crate::templates::UserData::from(&user.user))
        .unwrap_or_else(|_| "{}".to_string())
}

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[derive(serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum FlashSeverity {
    Error,
    Warning,
    Success,
    Info,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[derive(serde::Deserialize)]
pub(crate) struct FlashMessage {
    pub message: String,
    pub severity: FlashSeverity,
}

pub(crate) async fn set_flash(
    session: &Session,
    flash: FlashMessage,
) -> Result<(), crate::error::AppError> {
    session
        .insert(FLASH_KEY, flash)
        .await
        .map_err(|e| crate::error::AppError::Internal(format!("Session insert error: {e}")))?;
    Ok(())
}

pub(crate) async fn take_flash(
    session: &Session,
) -> Result<Option<FlashMessage>, crate::error::AppError> {
    let flash = session
        .get::<FlashMessage>(FLASH_KEY)
        .await
        .map_err(|e| crate::error::AppError::Internal(format!("Session get error: {e}")))?;
    if flash.is_some() {
        session
            .remove::<FlashMessage>(FLASH_KEY)
            .await
            .map_err(|e| crate::error::AppError::Internal(format!("Session remove error: {e}")))?;
    }
    Ok(flash)
}

#[cfg(test)]
mod tests {
    use super::{FlashMessage, FlashSeverity};

    #[test]
    fn flash_severity_serializes_to_lowercase() {
        let json = serde_json::to_string(&FlashMessage {
            message: "Joined".to_string(),
            severity: FlashSeverity::Success,
        })
        .expect("flash json");
        assert_eq!(json, r#"{"message":"Joined","severity":"success"}"#);
    }
}
