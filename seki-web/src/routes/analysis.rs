use askama::Template;
use axum::response::{Html, IntoResponse, Response};

use crate::error::AppError;
use crate::session::CurrentPlayer;
use crate::templates::analysis::AnalysisTemplate;
use crate::templates::PlayerData;

fn serialize_player_data(player: &CurrentPlayer) -> String {
    serde_json::to_string(&PlayerData::from(&player.player)).unwrap_or_else(|_| "{}".to_string())
}

// GET /analysis
pub async fn analysis_board(current_player: CurrentPlayer) -> Result<Response, AppError> {
    let tmpl = AnalysisTemplate {
        player_username: current_player.username.clone(),
        player_data: serialize_player_data(&current_player),
    };
    Ok(Html(
        tmpl.render()
            .map_err(|e| AppError::Internal(e.to_string()))?,
    )
    .into_response())
}
