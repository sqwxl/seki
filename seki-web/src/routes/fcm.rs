use axum::Json;
use axum::extract::{Path, State};
use serde::Deserialize;

use crate::AppState;
use crate::error::AppError;
use crate::models::fcm_token::FcmToken;
use crate::session::CurrentUser;

pub const MAX_TOKENS: i64 = 5;

#[derive(Deserialize)]
pub struct FcmTokenPayload {
    pub token: String,
    pub device_type: Option<String>,
    pub user_agent: Option<String>,
}

// POST /api/fcm-token
pub async fn register_fcm_token(
    State(state): State<AppState>,
    current_user: CurrentUser,
    Json(payload): Json<FcmTokenPayload>,
) -> Result<Json<serde_json::Value>, AppError> {
    if payload.token.is_empty() {
        return Err(AppError::UnprocessableEntity("Token is required".into()));
    }

    let count = FcmToken::count_for_user(&state.db, current_user.id)
        .await
        .map_err(AppError::Database)?;
    if count >= MAX_TOKENS {
        return Err(AppError::UnprocessableEntity(format!(
            "Maximum of {MAX_TOKENS} FCM tokens per user"
        )));
    }

    let user_agent = payload.user_agent.as_deref();

    if let Some(existing) = FcmToken::find_by_token(&state.db, &payload.token)
        .await
        .map_err(AppError::Database)?
    {
        if existing.user_id != current_user.id {
            return Err(AppError::Forbidden(
                "Token belongs to a different user".into(),
            ));
        }
        return Ok(Json(serde_json::json!({
            "id": existing.id,
            "ok": true,
        })));
    }

    let token = FcmToken::create(
        &state.db,
        current_user.id,
        &payload.token,
        payload.device_type.as_deref(),
        user_agent,
    )
    .await
    .map_err(AppError::Database)?;

    Ok(Json(serde_json::json!({
        "id": token.id,
        "ok": true,
    })))
}

// DELETE /api/fcm-token/{id}
pub async fn delete_fcm_token(
    State(state): State<AppState>,
    current_user: CurrentUser,
    Path(id): Path<i64>,
) -> Result<Json<serde_json::Value>, AppError> {
    let tokens = FcmToken::find_by_user(&state.db, current_user.id)
        .await
        .map_err(AppError::Database)?;

    if !tokens.iter().any(|t| t.id == id) {
        return Err(AppError::Forbidden(
            "Token does not belong to current user".into(),
        ));
    }

    FcmToken::disable(&state.db, id)
        .await
        .map_err(AppError::Database)?;

    Ok(Json(serde_json::json!({ "ok": true })))
}
