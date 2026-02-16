use axum::extract::FromRequestParts;
use axum::http::request::Parts;
use tower_sessions::Session;

use crate::error::{ApiError, AppError};
use crate::models::player::Player;

pub const PLAYER_ID_KEY: &str = "player_id";
pub const ANON_PLAYER_TOKEN_COOKIE: &str = "anon_player_token";

pub struct CurrentPlayer {
    pub player: Player,
}

impl std::ops::Deref for CurrentPlayer {
    type Target = Player;
    fn deref(&self) -> &Self::Target {
        &self.player
    }
}

impl FromRequestParts<crate::AppState> for CurrentPlayer {
    type Rejection = AppError;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &crate::AppState,
    ) -> Result<Self, Self::Rejection> {
        let session = Session::from_request_parts(parts, state)
            .await
            .map_err(|_| AppError::Internal("Session not available".to_string()))?;

        let pool = &state.db;

        // Try to find existing player from session
        if let Some(token) = session
            .get::<String>(PLAYER_ID_KEY)
            .await
            .map_err(|e| AppError::Internal(format!("Session get error: {e}")))?
        {
            if let Some(player) = Player::find_by_session_token(pool, &token).await? {
                return Ok(CurrentPlayer { player });
            }
            // Stale token, remove it
            tracing::warn!("Stale session token: {}", token);
            let _ = session.remove::<String>(PLAYER_ID_KEY).await;
        }

        // Create anonymous player
        let player = Player::create(pool).await?;
        let token = player
            .session_token
            .as_ref()
            .expect("newly created player should have session_token")
            .clone();
        session
            .insert(PLAYER_ID_KEY, token)
            .await
            .map_err(|e| AppError::Internal(format!("Session insert error: {e}")))?;

        Ok(CurrentPlayer { player })
    }
}

pub struct ApiPlayer {
    pub player: Player,
}

impl std::ops::Deref for ApiPlayer {
    type Target = Player;
    fn deref(&self) -> &Self::Target {
        &self.player
    }
}

impl FromRequestParts<crate::AppState> for ApiPlayer {
    type Rejection = ApiError;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &crate::AppState,
    ) -> Result<Self, Self::Rejection> {
        let header = parts
            .headers
            .get(axum::http::header::AUTHORIZATION)
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.strip_prefix("Bearer "))
            .map(|t| t.to_string())
            .ok_or_else(|| {
                ApiError(AppError::Unauthorized(
                    "Missing or invalid Authorization header".to_string(),
                ))
            })?;

        let player = Player::find_by_api_token(&state.db, &header)
            .await
            .map_err(|e| ApiError(AppError::Internal(format!("Database error: {e}"))))?
            .ok_or_else(|| {
                ApiError(AppError::Unauthorized("Invalid API token".to_string()))
            })?;

        if !player.is_registered() {
            return Err(ApiError(AppError::Unauthorized(
                "API tokens require a registered account".to_string(),
            )));
        }

        Ok(ApiPlayer { player })
    }
}
