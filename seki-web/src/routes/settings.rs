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
