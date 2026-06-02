use axum::Json;
use axum::extract::State;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Redirect, Response};
use serde::Deserialize;
use serde_json::json;
use tower_sessions::Session;

use crate::AppState;
use crate::error::AppError;
use crate::models::rating::RatingProfile;
use crate::models::user::User;
use crate::routes::flash::{FlashMessage, FlashSeverity, set_flash, wants_json};
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

    let user = User::generate_api_token(&state.db, current_user.id).await?;

    let url = format!("/users/{}", current_user.username);
    if json {
        Ok(Json(json!({"redirect": url, "api_token": user.api_token})).into_response())
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
    if let Some(value) = body.get("rating_display") {
        match value.as_str() {
            Some("kyu_dan" | "rating") => {}
            _ => {
                return Err(AppError::UnprocessableEntity(
                    "rating_display must be kyu_dan or rating".to_string(),
                ));
            }
        }
    }
    if let Some(value) = body.get("rating_participating")
        && !value.is_boolean()
    {
        return Err(AppError::UnprocessableEntity(
            "rating_participating must be true or false".to_string(),
        ));
    }

    let mut preferences_patch = body.clone();
    let rating_participating = preferences_patch
        .as_object_mut()
        .and_then(|object| object.remove("rating_participating"))
        .and_then(|value| value.as_bool());

    if let Some(participating) = rating_participating {
        RatingProfile::set_participating(&state.db, current_user.id, participating).await?;
    }

    let user = if preferences_patch
        .as_object()
        .is_some_and(|object| object.is_empty())
    {
        User::find_by_id(&state.db, current_user.id).await?
    } else {
        User::update_preferences(&state.db, current_user.id, &preferences_patch).await?
    };

    let profile = RatingProfile::find(&state.db, current_user.id).await?;
    let mut preferences = user.preferences_with_defaults();

    if user.is_registered() {
        preferences["rating_participating"] = profile
            .as_ref()
            .is_none_or(|profile| profile.participating)
            .into();
    }

    Ok(Json(preferences))
}

#[derive(Deserialize)]
pub struct UpdateEmailForm {
    pub email: String,
}

// POST /settings/email
pub async fn update_email(
    State(state): State<AppState>,
    session: Session,
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
        set_flash(
            &session,
            FlashMessage {
                message: msg.to_string(),
                severity: FlashSeverity::Error,
            },
        )
        .await?;
        return Ok(Redirect::to("/settings").into_response());
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
        set_flash(
            &session,
            FlashMessage {
                message: msg.to_string(),
                severity: FlashSeverity::Error,
            },
        )
        .await?;
        return Ok(Redirect::to("/settings").into_response());
    }

    User::update_email(&state.db, current_user.id, &email).await?;

    let url = format!("/users/{}", current_user.username);
    if json {
        Ok(Json(json!({"redirect": url})).into_response())
    } else {
        Ok(Redirect::to(&url).into_response())
    }
}
