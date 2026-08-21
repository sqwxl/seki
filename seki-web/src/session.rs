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
        let user_id = match session.get::<i64>(USER_ID_KEY).await {
            Ok(id) => id,
            // Unreadable identity (pre-user-id session format) — logged out.
            Err(e) => {
                tracing::warn!("Session identity unreadable (legacy format?): {e}");
                None
            }
        };
        if let Some(user_id) = user_id {
            match User::find_by_id(pool, user_id).await {
                Ok(user) => return Ok(CurrentUser { user }),
                Err(sqlx::Error::RowNotFound) => {
                    // Stale user id, remove it
                    tracing::warn!("Stale session user id: {user_id}");
                    let _ = session.remove::<i64>(USER_ID_KEY).await;
                }
                Err(e) => return Err(e.into()),
            }
        }

        // Create anonymous user
        let user = User::create(pool).await?;
        session
            .insert(USER_ID_KEY, user.id)
            .await
            .map_err(|e| AppError::Internal(format!("Session insert error: {e}")))?;

        Ok(CurrentUser { user })
    }
}

pub struct OptionalCurrentUser {
    pub user: Option<User>,
}

impl FromRequestParts<crate::AppState> for OptionalCurrentUser {
    type Rejection = AppError;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &crate::AppState,
    ) -> Result<Self, Self::Rejection> {
        let session = Session::from_request_parts(parts, state)
            .await
            .map_err(|_| AppError::Internal("Session not available".to_string()))?;

        let Some(user_id) = session.get::<i64>(USER_ID_KEY).await.unwrap_or(None) else {
            return Ok(OptionalCurrentUser { user: None });
        };

        match User::find_by_id(&state.db, user_id).await {
            Ok(user) => return Ok(OptionalCurrentUser { user: Some(user) }),
            Err(sqlx::Error::RowNotFound) => {
                tracing::warn!("Stale session user id: {user_id}");
                let _ = session.remove::<i64>(USER_ID_KEY).await;
            }
            Err(e) => return Err(e.into()),
        }

        Ok(OptionalCurrentUser { user: None })
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

        let user = if let Some(u) = User::find_or_create_dev_bot(&state.db, &header)
            .await
            .map_err(|e| ApiError(AppError::Internal(format!("Database error: {e}"))))?
        {
            u
        } else {
            User::find_by_api_token(&state.db, &header)
                .await
                .map_err(|e| ApiError(AppError::Internal(format!("Database error: {e}"))))?
                .ok_or_else(|| ApiError(AppError::Unauthorized("Invalid API token".to_string())))?
        };

        if !user.is_registered() {
            return Err(ApiError(AppError::Unauthorized(
                "API tokens require a registered account".to_string(),
            )));
        }

        Ok(ApiUser { user })
    }
}

/// Optional API user extractor - returns None if no auth header or invalid token.
/// Unlike ApiUser, this doesn't reject the request on missing/invalid auth.
pub struct OptionalApiUser(pub Option<User>);

impl std::ops::Deref for OptionalApiUser {
    type Target = Option<User>;
    fn deref(&self) -> &Self::Target {
        &self.0
    }
}

impl FromRequestParts<crate::AppState> for OptionalApiUser {
    type Rejection = std::convert::Infallible;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &crate::AppState,
    ) -> Result<Self, Self::Rejection> {
        let Some(header) = parts
            .headers
            .get(axum::http::header::AUTHORIZATION)
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.strip_prefix("Bearer "))
            .map(|t| t.to_string())
        else {
            return Ok(OptionalApiUser(None));
        };

        let dev_bot = User::find_or_create_dev_bot(&state.db, &header)
            .await
            .ok()
            .flatten();

        let user = if let Some(u) = dev_bot {
            Some(u)
        } else {
            User::find_by_api_token(&state.db, &header)
                .await
                .ok()
                .flatten()
                .filter(|u| u.is_registered())
        };

        Ok(OptionalApiUser(user))
    }
}
