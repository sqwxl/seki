use askama::Template;
use axum::extract::{Path, State};
use axum::response::{Html, IntoResponse, Response};

use crate::AppState;
use crate::error::AppError;
use crate::models::game::Game;
use crate::models::user::User;
use crate::services::live::build_live_items;
use crate::session::CurrentUser;
use crate::templates::UserData;
use crate::templates::user_profile::UserProfileTemplate;

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

    let tmpl = UserProfileTemplate {
        user_username: current_user.username.clone(),
        user_is_registered: current_user.is_registered(),
        user_data: serialize_user_data(&current_user),
        profile_username: profile_user.username.clone(),
        initial_games,
    };

    Ok(Html(
        tmpl.render()
            .map_err(|e| AppError::Internal(e.to_string()))?,
    )
    .into_response())
}
