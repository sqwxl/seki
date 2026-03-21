use axum::Json;
use axum::extract::State;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Redirect, Response};
use serde::Deserialize;
use serde_json::json;

use crate::AppState;
use crate::error::AppError;
use crate::models::user::User;
use crate::routes::wants_json;
use crate::session::CurrentUser;

// GET /settings — redirect to own profile
pub async fn settings_page(current_user: CurrentUser) -> Response {
    Redirect::to(&format!("/users/{}", current_user.username)).into_response()
}

// POST /settings/token
pub async fn generate_token(
    State(state): State<AppState>,
    current_user: CurrentUser,
    headers: axum::http::HeaderMap,
) -> Result<Response, AppError> {
    let json = wants_json(&headers);
    if !current_user.is_registered() {
        if json {
            return Ok(Json(json!({"redirect": "/login"})).into_response());
        }
        return Ok(Redirect::to("/login").into_response());
    }

    User::generate_api_token(&state.db, current_user.id).await?;

    let url = format!("/users/{}", current_user.username);
    if json {
        Ok(Json(json!({"redirect": url})).into_response())
    } else {
        Ok(Redirect::to(&url).into_response())
    }
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

#[derive(Deserialize)]
pub struct UpdateEmailForm {
    pub email: String,
}

// POST /settings/email
pub async fn update_email(
    State(state): State<AppState>,
    current_user: CurrentUser,
    headers: axum::http::HeaderMap,
    axum::Form(form): axum::Form<UpdateEmailForm>,
) -> Result<Response, AppError> {
    let email = form.email.trim().to_string();
    let json = wants_json(&headers);

    if email.parse::<lettre::Address>().is_err() {
        let msg = "Please enter a valid email address.";
        if json {
            return Ok((
                StatusCode::UNPROCESSABLE_ENTITY,
                Json(json!({"error": msg, "field": "email"})),
            )
                .into_response());
        }
        return Err(AppError::UnprocessableEntity(msg.to_string()));
    }

    // Check for duplicates (another user with this email)
    if let Some(existing) = User::find_by_email(&state.db, &email).await?
        && existing.id != current_user.id
    {
        let msg = "This email is already in use.";
        if json {
            return Ok((
                StatusCode::UNPROCESSABLE_ENTITY,
                Json(json!({"error": msg, "field": "email"})),
            )
                .into_response());
        }
        return Err(AppError::UnprocessableEntity(msg.to_string()));
    }

    User::update_email(&state.db, current_user.id, &email).await?;

    let url = format!("/users/{}", current_user.username);
    if json {
        Ok(Json(json!({"redirect": url})).into_response())
    } else {
        Ok(Redirect::to(&url).into_response())
    }
}
