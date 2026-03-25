use axum::Form;
use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Redirect, Response};
use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::AppState;
use crate::error::AppError;
use crate::models::user::User;
use crate::routes::wants_json;
use crate::session::CurrentUser;

#[derive(Deserialize)]
pub struct SearchQuery {
    pub q: Option<String>,
}

#[derive(Serialize)]
pub struct SearchResult {
    pub username: String,
    pub is_registered: bool,
    pub is_online: bool,
    pub is_recent: bool,
}

// GET /users/search?q=<optional>
pub async fn search_users(
    State(state): State<AppState>,
    current_user: CurrentUser,
    Query(query): Query<SearchQuery>,
) -> Result<axum::Json<Vec<SearchResult>>, AppError> {
    let rows = match query.q.as_deref() {
        Some(q) if !q.is_empty() => {
            User::search_by_prefix(&state.db, q, current_user.id, 30).await?
        }
        _ => User::list_for_challenge(&state.db, current_user.id, 30).await?,
    };

    let user_ids: Vec<i64> = rows.iter().map(|r| r.id).collect();
    let online_ids = state.presence.connected_ids(&user_ids).await;

    // DB already sorts: recent opponents first, then last active.
    // Stable re-sort to bubble online users up within each group.
    let mut results: Vec<SearchResult> = rows
        .into_iter()
        .map(|r| SearchResult {
            username: r.username.clone(),
            is_registered: r.is_registered(),
            is_online: online_ids.contains(&r.id),
            is_recent: r.is_recent,
        })
        .collect();

    results.sort_by(|a, b| {
        b.is_recent
            .cmp(&a.is_recent)
            .then(b.is_online.cmp(&a.is_online))
    });

    Ok(axum::Json(results))
}

#[derive(Deserialize)]
pub struct UpdateUsernameForm {
    pub username: String,
}

// POST /users/:username
pub async fn update_username(
    State(state): State<AppState>,
    current_user: CurrentUser,
    headers: axum::http::HeaderMap,
    Path(username): Path<String>,
    Form(form): Form<UpdateUsernameForm>,
) -> Result<Response, AppError> {
    // Must be viewing own profile and registered
    let profile_user = User::find_by_username(&state.db, &username)
        .await?
        .ok_or_else(|| AppError::NotFound("User not found".to_string()))?;

    if current_user.id != profile_user.id || !current_user.is_registered() {
        return Err(AppError::Unauthorized("Not allowed".to_string()));
    }

    let new_username = form.username.trim().to_string();
    let json = wants_json(&headers);

    // Validate
    if new_username.is_empty() || new_username.len() > 30 {
        let msg = "Username must be between 1 and 30 characters.";
        if json {
            return Ok((
                StatusCode::UNPROCESSABLE_ENTITY,
                axum::Json(json!({"error": msg, "field": "username"})),
            )
                .into_response());
        }
        let query = serde_urlencoded::to_string([("error", msg)])
            .map_err(|e| AppError::Internal(e.to_string()))?;
        return Ok(
            Redirect::to(&format!("/users/{}?{query}", profile_user.username)).into_response(),
        );
    }

    // No change
    if new_username == profile_user.username {
        let url = format!("/users/{new_username}");
        if json {
            return Ok(axum::Json(json!({"redirect": url})).into_response());
        }
        return Ok(Redirect::to(&url).into_response());
    }

    // Check uniqueness
    if User::find_by_username(&state.db, &new_username)
        .await?
        .is_some()
    {
        let msg = "Username is already taken.";
        if json {
            return Ok((
                StatusCode::UNPROCESSABLE_ENTITY,
                axum::Json(json!({"error": msg, "field": "username"})),
            )
                .into_response());
        }
        let query = serde_urlencoded::to_string([("error", msg)])
            .map_err(|e| AppError::Internal(e.to_string()))?;
        return Ok(
            Redirect::to(&format!("/users/{}?{query}", profile_user.username)).into_response(),
        );
    }

    // Update
    match User::update_username(&state.db, current_user.id, &new_username).await {
        Ok(_) => {
            let url = format!("/users/{new_username}");
            if json {
                Ok(axum::Json(json!({"redirect": url})).into_response())
            } else {
                Ok(Redirect::to(&url).into_response())
            }
        }
        Err(sqlx::Error::Database(e)) if e.is_unique_violation() => {
            let msg = "Username is already taken.";
            if json {
                return Ok((
                    StatusCode::UNPROCESSABLE_ENTITY,
                    axum::Json(json!({"error": msg, "field": "username"})),
                )
                    .into_response());
            }
            let query = serde_urlencoded::to_string([("error", msg)])
                .map_err(|e| AppError::Internal(e.to_string()))?;
            Ok(Redirect::to(&format!("/users/{}?{query}", profile_user.username)).into_response())
        }
        Err(e) => Err(AppError::Internal(e.to_string())),
    }
}
