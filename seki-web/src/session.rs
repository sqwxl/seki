use axum::extract::FromRequestParts;
use axum::http::request::Parts;
use tower_sessions::Session;

use crate::error::{ApiError, AppError};
use crate::models::user::User;

pub const USER_ID_KEY: &str = "user_id";
pub const ANON_USER_TOKEN_COOKIE: &str = "anon_user_token";

pub struct CurrentUser {
    pub user: User,
}

impl std::ops::Deref for CurrentUser {
    type Target = User;
    fn deref(&self) -> &Self::Target {
        &self.user
    }
}

impl FromRequestParts<crate::AppState> for CurrentUser {
    type Rejection = AppError;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &crate::AppState,
    ) -> Result<Self, Self::Rejection> {
        let session = Session::from_request_parts(parts, state)
            .await
            .map_err(|_| AppError::Internal("Session not available".to_string()))?;

        let pool = &state.db;

        // Try to find existing user from session
        if let Some(token) = session
            .get::<String>(USER_ID_KEY)
            .await
            .map_err(|e| AppError::Internal(format!("Session get error: {e}")))?
        {
            if let Some(user) = User::find_by_session_token(pool, &token).await? {
                return Ok(CurrentUser { user });
            }
            // Stale token, remove it
            tracing::warn!("Stale session token: {}", token);
            let _ = session.remove::<String>(USER_ID_KEY).await;
        }

        // Create anonymous user
        let user = User::create(pool).await?;
        let token = user
            .session_token
            .as_ref()
            .expect("newly created user should have session_token")
            .clone();
        session
            .insert(USER_ID_KEY, token)
            .await
            .map_err(|e| AppError::Internal(format!("Session insert error: {e}")))?;

        Ok(CurrentUser { user })
    }
}

pub struct ApiUser {
    pub user: User,
}

impl std::ops::Deref for ApiUser {
    type Target = User;
    fn deref(&self) -> &Self::Target {
        &self.user
    }
}

impl FromRequestParts<crate::AppState> for ApiUser {
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

        let user = User::find_by_api_token(&state.db, &header)
            .await
            .map_err(|e| ApiError(AppError::Internal(format!("Database error: {e}"))))?
            .ok_or_else(|| ApiError(AppError::Unauthorized("Invalid API token".to_string())))?;

        if !user.is_registered() {
            return Err(ApiError(AppError::Unauthorized(
                "API tokens require a registered account".to_string(),
            )));
        }

        Ok(ApiUser { user })
    }
}
