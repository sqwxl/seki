use askama::Template;
use axum::extract::State;
use axum::response::{Html, IntoResponse, Redirect, Response};

use crate::AppState;
use crate::error::AppError;
use crate::models::user::User;
use crate::session::CurrentUser;
use crate::templates::UserData;
use crate::templates::settings::SettingsTemplate;

fn serialize_user_data(user: &CurrentUser) -> String {
    serde_json::to_string(&UserData::from(&user.user)).unwrap_or_else(|_| "{}".to_string())
}

// GET /settings
pub async fn settings_page(current_user: CurrentUser) -> Result<Response, AppError> {
    if !current_user.is_registered() {
        return Ok(Redirect::to("/login?redirect=/settings").into_response());
    }

    let tmpl = SettingsTemplate {
        user_username: current_user.username.clone(),
        user_is_registered: true,
        user_data: serialize_user_data(&current_user),
        api_token: current_user.api_token.clone(),
        flash: None,
    };
    Ok(Html(
        tmpl.render()
            .map_err(|e| AppError::Internal(e.to_string()))?,
    )
    .into_response())
}

// POST /settings/token
pub async fn generate_token(
    State(state): State<AppState>,
    current_user: CurrentUser,
) -> Result<Response, AppError> {
    if !current_user.is_registered() {
        return Ok(Redirect::to("/login?redirect=/settings").into_response());
    }

    User::generate_api_token(&state.db, current_user.id).await?;

    Ok(Redirect::to("/settings").into_response())
}
