use axum::Json;
use axum::extract::State;
use axum::response::{IntoResponse, Redirect, Response};

use crate::AppState;
use crate::error::AppError;
use crate::models::user::User;
use crate::session::CurrentUser;

// GET /settings — redirect to own profile
pub async fn settings_page(current_user: CurrentUser) -> Response {
    Redirect::to(&format!("/users/{}", current_user.username)).into_response()
}

// POST /settings/token
pub async fn generate_token(
    State(state): State<AppState>,
    current_user: CurrentUser,
) -> Result<Response, AppError> {
    if !current_user.is_registered() {
        return Ok(Redirect::to("/login").into_response());
    }

    User::generate_api_token(&state.db, current_user.id).await?;

    Ok(Redirect::to(&format!("/users/{}", current_user.username)).into_response())
}

// PATCH /settings/preferences
pub async fn update_preferences(
    State(state): State<AppState>,
    current_user: CurrentUser,
    Json(body): Json<serde_json::Value>,
) -> Result<Json<serde_json::Value>, AppError> {
    if !body.is_object() {
        return Err(AppError::UnprocessableEntity(
            "Expected a JSON object".to_string(),
        ));
    }

    let user = User::update_preferences(&state.db, current_user.id, &body).await?;

    Ok(Json(user.preferences))
}
