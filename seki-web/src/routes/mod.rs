pub mod api;
pub mod auth;
pub mod games;
pub mod health;
pub mod settings;
pub mod spa;
pub mod users;
pub mod web_api;

use serde::Serialize;

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
#[serde(rename_all = "lowercase")]
pub(crate) enum FlashSeverity {
    Error,
    Warning,
    Success,
    Info,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
pub(crate) struct FlashMessage {
    pub message: String,
    pub severity: FlashSeverity,
}

pub(crate) fn flash_redirect(target: &str, flash: FlashMessage) -> Result<String, crate::error::AppError> {
    let separator = if target.contains('?') { '&' } else { '?' };
    let query = serde_urlencoded::to_string([
        ("flash", flash.message),
        ("flash_level", flash.severity.as_str().to_string()),
    ])
    .map_err(|e| crate::error::AppError::Internal(e.to_string()))?;
    Ok(format!("{target}{separator}{query}"))
}

pub(crate) fn flash_from_query(query: Option<&str>) -> Option<FlashMessage> {
    let query = query?;
    let params: std::collections::HashMap<String, String> =
        serde_urlencoded::from_str(query).ok()?;
    let message = params.get("flash")?.trim();
    if message.is_empty() {
        return None;
    }
    Some(FlashMessage {
        message: message.to_string(),
        severity: match params.get("flash_level").map(|level| level.as_str()) {
            Some("warning") => FlashSeverity::Warning,
            Some("success") => FlashSeverity::Success,
            Some("info") => FlashSeverity::Info,
            _ => FlashSeverity::Error,
        },
    })
}

impl FlashSeverity {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::Error => "error",
            Self::Warning => "warning",
            Self::Success => "success",
            Self::Info => "info",
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{FlashMessage, FlashSeverity, flash_from_query, flash_redirect};

    #[test]
    fn flash_redirect_encodes_expected_query_params() {
        let url = flash_redirect(
            "/games/new",
            FlashMessage {
                message: "Bad request".to_string(),
                severity: FlashSeverity::Error,
            },
        )
        .expect("flash redirect");
        assert_eq!(url, "/games/new?flash=Bad+request&flash_level=error");
    }

    #[test]
    fn flash_redirect_appends_to_existing_query_string() {
        let url = flash_redirect(
            "/login?redirect=%2Fgames",
            FlashMessage {
                message: "Please log in".to_string(),
                severity: FlashSeverity::Warning,
            },
        )
        .expect("flash redirect");
        assert_eq!(
            url,
            "/login?redirect=%2Fgames&flash=Please+log+in&flash_level=warning"
        );
    }

    #[test]
    fn flash_from_query_parses_flash_payload() {
        let flash = flash_from_query(Some("flash=Joined&flash_level=success"))
            .expect("flash payload");
        assert_eq!(
            flash,
            FlashMessage {
                message: "Joined".to_string(),
                severity: FlashSeverity::Success,
            }
        );
    }
}
