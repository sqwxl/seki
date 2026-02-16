use serde::Serialize;
use serde_json::json;

use crate::models::game::{Game, GameWithPlayers};
use crate::AppState;

#[derive(Serialize)]
pub struct LiveGameItem {
    pub id: i64,
    pub description: String,
    pub stage: String,
    pub result: Option<String>,
    pub black_id: Option<i64>,
    pub white_id: Option<i64>,
    pub is_private: bool,
}

impl LiveGameItem {
    pub fn from_gwp(gwp: &GameWithPlayers, move_count: Option<usize>) -> Self {
        let stage = gwp.game.stage.parse().unwrap_or(go_engine::Stage::Unstarted);
        Self {
            id: gwp.game.id,
            description: gwp.description_with_stage(&stage, move_count),
            stage: gwp.game.stage.clone(),
            result: gwp.game.result.clone(),
            black_id: gwp.game.black_id,
            white_id: gwp.game.white_id,
            is_private: gwp.game.is_private,
        }
    }
}

/// Notify live clients that a game was created or updated.
pub async fn notify_game_changed(state: &AppState, game_id: i64, move_count: Option<usize>) {
    let gwp = match Game::find_with_players(&state.db, game_id).await {
        Ok(gwp) => gwp,
        Err(e) => {
            tracing::warn!("live::notify_game_changed failed to load game {game_id}: {e}");
            return;
        }
    };

    let item = LiveGameItem::from_gwp(&gwp, move_count);
    let msg = json!({
        "kind": "game_updated",
        "game": item,
    })
    .to_string();

    let _ = state.live_tx.send(msg);
}

/// Notify live clients that a game was removed (aborted/deleted).
pub fn notify_game_removed(state: &AppState, game_id: i64) {
    let msg = json!({
        "kind": "game_removed",
        "game_id": game_id,
    })
    .to_string();

    let _ = state.live_tx.send(msg);
}
