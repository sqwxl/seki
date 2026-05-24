use axum::response::{IntoResponse, Redirect, Response};
use serde::Serialize;
use tower_sessions::Session;

use crate::error::AppError;

// TODO: move "flash" code to sibling flash.rs module
const FLASH_KEY: &str = "flash";

pub(crate) fn wants_json(headers: &axum::http::HeaderMap) -> bool {
    headers
        .get(axum::http::header::ACCEPT)
        .and_then(|v| v.to_str().ok())
        .is_some_and(|s| s.contains("application/json"))
}

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum FlashSeverity {
    Error,
    Warning,
    Success,
    Info,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq, serde::Deserialize)]
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

pub(crate) async fn redirect_with_flash(
    session: &Session,
    target: &str,
    message: &str,
) -> Result<Response, AppError> {
    set_flash(
        session,
        FlashMessage {
            message: message.to_string(),
            severity: FlashSeverity::Error,
        },
    )
    .await?;
    Ok(Redirect::to(target).into_response())
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
