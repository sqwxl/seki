use askama::Template;
use axum::extract::State;
use axum::response::{Html, IntoResponse, Redirect, Response};

use crate::AppState;
use crate::error::AppError;
use crate::models::player::Player;
use crate::session::CurrentPlayer;
use crate::templates::PlayerData;
use crate::templates::settings::SettingsTemplate;

fn serialize_player_data(player: &CurrentPlayer) -> String {
    serde_json::to_string(&PlayerData::from(&player.player)).unwrap_or_else(|_| "{}".to_string())
}

// GET /settings
pub async fn settings_page(current_player: CurrentPlayer) -> Result<Response, AppError> {
    if !current_player.is_registered() {
        return Ok(Redirect::to("/login?redirect=/settings").into_response());
    }

    let tmpl = SettingsTemplate {
        player_username: current_player.username.clone(),
        player_is_registered: true,
        player_data: serialize_player_data(&current_player),
        api_token: current_player.api_token.clone(),
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
    current_player: CurrentPlayer,
) -> Result<Response, AppError> {
    if !current_player.is_registered() {
        return Ok(Redirect::to("/login?redirect=/settings").into_response());
    }

    Player::generate_api_token(&state.db, current_player.id).await?;

    Ok(Redirect::to("/settings").into_response())
}
