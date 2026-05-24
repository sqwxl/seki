use axum::Json;
use axum::extract::{Path, State};
use serde::Deserialize;

use crate::AppState;
use crate::error::AppError;
use crate::models::push_destination::PushDestination;
use crate::session::CurrentUser;

// TODO: why 10? Also, move to config
pub const MAX_DESTINATIONS: i64 = 10;

#[derive(Deserialize)]
pub struct PushSubscriptionPayload {
    pub endpoint: String,
    #[serde(default)]
    pub user_agent: Option<String>,
    pub keys: PushSubscriptionKeys,
}

#[derive(Deserialize)]
pub struct PushSubscriptionKeys {
    pub p256dh: String,
    pub auth: String,
}

#[derive(Deserialize)]
pub struct SuppressPayload {
    pub subscription_id: i64,
}

// GET /api/web/vapid-public-key
pub async fn vapid_public_key(State(state): State<AppState>) -> Json<serde_json::Value> {
    let keys = crate::models::vapid_config::load_or_generate(&state.db)
        .await
        .unwrap_or_default();
    Json(serde_json::json!({
        "public_key": keys.public_key,
    }))
}

// POST /api/push-subscription
pub async fn register_subscription(
    State(state): State<AppState>,
    current_user: CurrentUser,
    Json(payload): Json<PushSubscriptionPayload>,
) -> Result<Json<serde_json::Value>, AppError> {
    if !payload.endpoint.starts_with("https://") {
        return Err(AppError::UnprocessableEntity(
            "Endpoint must be HTTPS".into(),
        ));
    }
    if payload.keys.p256dh.is_empty() || payload.keys.auth.is_empty() {
        return Err(AppError::UnprocessableEntity(
            "Missing required keys: p256dh, auth".into(),
        ));
    }

    let count = PushDestination::count_for_user(&state.db, current_user.id)
        .await
        .map_err(AppError::Database)?;
    if count >= MAX_DESTINATIONS {
        return Err(AppError::UnprocessableEntity(format!(
            "Maximum of {MAX_DESTINATIONS} push destinations per user"
        )));
    }

    let user_agent = payload.user_agent.unwrap_or_default();

    if let Some(existing) = PushDestination::find_by_endpoint(&state.db, &payload.endpoint)
        .await
        .map_err(AppError::Database)?
    {
        if existing.user_id != current_user.id {
            return Err(AppError::Forbidden(
                "Subscription belongs to a different user".into(),
            ));
        }
        PushDestination::update_keys(
            &state.db,
            existing.id,
            &payload.keys.p256dh,
            &payload.keys.auth,
        )
        .await
        .map_err(AppError::Database)?;
        let keys = crate::models::vapid_config::load_or_generate(&state.db)
            .await
            .unwrap_or_default();
        return Ok(Json(serde_json::json!({
            "id": existing.id,
            "user_agent": user_agent,
            "enabled": true,
            "vapid_public_key": keys.public_key,
        })));
    }

    let destination = PushDestination::create(
        &state.db,
        current_user.id,
        &payload.endpoint,
        &payload.keys.p256dh,
        &payload.keys.auth,
        Some(&user_agent),
    )
    .await
    .map_err(AppError::Database)?;

    let keys = crate::models::vapid_config::load_or_generate(&state.db)
        .await
        .unwrap_or_default();

    Ok(Json(serde_json::json!({
        "id": destination.id,
        "user_agent": user_agent,
        "enabled": true,
        "vapid_public_key": keys.public_key,
    })))
}

// GET /api/push-subscription
pub async fn list_subscriptions(
    State(state): State<AppState>,
    current_user: CurrentUser,
) -> Result<Json<serde_json::Value>, AppError> {
    let subscriptions = PushDestination::find_meta_by_user(&state.db, current_user.id)
        .await
        .map_err(AppError::Database)?;

    let list: Vec<serde_json::Value> = subscriptions
        .iter()
        .map(|s| {
            serde_json::json!({
                "id": s.id,
                "user_agent": s.user_agent,
                "enabled": s.enabled,
                "last_delivered_at": s.last_delivered_at,
                "last_failure_at": s.last_failure_at,
                "created_at": s.created_at.to_rfc3339(),
            })
        })
        .collect();

    Ok(Json(serde_json::json!({ "subscriptions": list })))
}

// DELETE /api/push-subscription/{id}
pub async fn disable_subscription(
    State(state): State<AppState>,
    current_user: CurrentUser,
    Path(id): Path<i64>,
) -> Result<Json<serde_json::Value>, AppError> {
    let all = PushDestination::find_by_user(&state.db, current_user.id)
        .await
        .map_err(AppError::Database)?;

    if !all.iter().any(|d| d.id == id) {
        return Err(AppError::Forbidden(
            "Subscription does not belong to current user".into(),
        ));
    }

    PushDestination::disable(&state.db, id)
        .await
        .map_err(AppError::Database)?;

    Ok(Json(serde_json::json!({ "ok": true })))
}

// POST /api/push-subscription/suppress — not implemented yet (deferred)
