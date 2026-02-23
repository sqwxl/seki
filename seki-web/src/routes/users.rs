use askama::Template;
use axum::Form;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::{Html, IntoResponse, Redirect, Response};

use crate::AppState;
use crate::error::AppError;
use crate::models::game::Game;
use crate::models::user::User;
use crate::services::live::build_live_items;
use crate::session::CurrentUser;
use crate::templates::UserData;
use crate::templates::user_profile::UserProfileTemplate;

#[derive(serde::Deserialize)]
pub struct UpdateUsernameForm {
    pub username: String,
}

fn serialize_user_data(user: &CurrentUser) -> String {
    serde_json::to_string(&UserData::from(&user.user)).unwrap_or_else(|_| "{}".to_string())
}

// GET /users/:username
pub async fn profile(
    State(state): State<AppState>,
    current_user: CurrentUser,
    Path(username): Path<String>,
) -> Result<Response, AppError> {
    let profile_user = User::find_by_username(&state.db, &username)
        .await?
        .ok_or_else(|| AppError::NotFound("User not found".to_string()))?;

    let games = Game::list_all_for_player(&state.db, profile_user.id)
        .await
        .unwrap_or_default();

    let items = build_live_items(&state.db, &games).await;

    let initial_games = serde_json::to_string(&serde_json::json!({
        "profile_user_id": profile_user.id,
        "games": items,
    }))
    .unwrap_or_default();

    let is_own_profile = current_user.id == profile_user.id;

    let tmpl = UserProfileTemplate {
        user_username: current_user.username.clone(),
        user_is_registered: current_user.is_registered(),
        user_data: serialize_user_data(&current_user),
        profile_username: profile_user.username.clone(),
        initial_games,
        is_own_profile,
        api_token: if is_own_profile {
            current_user.api_token.clone()
        } else {
            None
        },
        flash: None,
    };

    Ok(Html(
        tmpl.render()
            .map_err(|e| AppError::Internal(e.to_string()))?,
    )
    .into_response())
}

// POST /users/:username
pub async fn update_username(
    State(state): State<AppState>,
    current_user: CurrentUser,
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

    // Validate
    if new_username.is_empty() || new_username.len() > 30 {
        return render_profile_with_flash(
            &state,
            &current_user,
            &profile_user,
            "Username must be between 1 and 30 characters.",
        )
        .await;
    }

    // No change
    if new_username == profile_user.username {
        return Ok(Redirect::to(&format!("/users/{new_username}")).into_response());
    }

    // Check uniqueness
    if User::find_by_username(&state.db, &new_username)
        .await?
        .is_some()
    {
        return render_profile_with_flash(
            &state,
            &current_user,
            &profile_user,
            "Username is already taken.",
        )
        .await;
    }

    // Update
    match User::update_username(&state.db, current_user.id, &new_username).await {
        Ok(_) => Ok(Redirect::to(&format!("/users/{new_username}")).into_response()),
        Err(sqlx::Error::Database(e)) if e.is_unique_violation() => {
            render_profile_with_flash(
                &state,
                &current_user,
                &profile_user,
                "Username is already taken.",
            )
            .await
        }
        Err(e) => Err(AppError::Internal(e.to_string())),
    }
}

async fn render_profile_with_flash(
    state: &AppState,
    current_user: &CurrentUser,
    profile_user: &User,
    flash: &str,
) -> Result<Response, AppError> {
    let games = Game::list_all_for_player(&state.db, profile_user.id)
        .await
        .unwrap_or_default();

    let items = build_live_items(&state.db, &games).await;

    let initial_games = serde_json::to_string(&serde_json::json!({
        "profile_user_id": profile_user.id,
        "games": items,
    }))
    .unwrap_or_default();

    let tmpl = UserProfileTemplate {
        user_username: current_user.username.clone(),
        user_is_registered: current_user.is_registered(),
        user_data: serialize_user_data(current_user),
        profile_username: profile_user.username.clone(),
        initial_games,
        is_own_profile: true,
        api_token: current_user.api_token.clone(),
        flash: Some(flash.to_string()),
    };

    Ok((
        StatusCode::UNPROCESSABLE_ENTITY,
        Html(
            tmpl.render()
                .map_err(|e| AppError::Internal(e.to_string()))?,
        ),
    )
        .into_response())
}
