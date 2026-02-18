use serde::Serialize;
use serde_json::json;

use crate::AppState;
use crate::models::game::{Game, GameWithPlayers, TimeControlType};
use crate::templates::UserData;

#[derive(Serialize)]
pub struct GameSettings {
    pub cols: i32,
    pub rows: i32,
    pub time_control: TimeControlType,
    pub main_time_secs: Option<i32>,
    pub increment_secs: Option<i32>,
    pub byoyomi_time_secs: Option<i32>,
    pub byoyomi_periods: Option<i32>,
    pub is_private: bool,
}

/// Full game item sent in lobby `init` and `game_created` messages.
#[derive(Serialize)]
pub struct LiveGameItem {
    pub id: i64,
    pub stage: String,
    pub result: Option<String>,
    pub black: Option<UserData>,
    pub white: Option<UserData>,
    pub settings: GameSettings,
    pub move_count: Option<usize>,
}

impl LiveGameItem {
    pub fn from_gwp(gwp: &GameWithPlayers, move_count: Option<usize>) -> Self {
        Self {
            id: gwp.game.id,
            stage: gwp.game.stage.clone(),
            result: gwp.game.result.clone(),
            black: gwp.black.as_ref().map(UserData::from),
            white: gwp.white.as_ref().map(UserData::from),
            settings: GameSettings {
                cols: gwp.game.cols,
                rows: gwp.game.rows,
                time_control: gwp.game.time_control,
                main_time_secs: gwp.game.main_time_secs,
                increment_secs: gwp.game.increment_secs,
                byoyomi_time_secs: gwp.game.byoyomi_time_secs,
                byoyomi_periods: gwp.game.byoyomi_periods,
                is_private: gwp.game.is_private,
            },
            move_count,
        }
    }
}

/// Lightweight update (no settings — clients already have them from `init` or `game_created`).
#[derive(Serialize)]
struct GameUpdate {
    id: i64,
    stage: String,
    result: Option<String>,
    black: Option<UserData>,
    white: Option<UserData>,
    move_count: Option<usize>,
}

/// Notify live clients that a new game appeared (created or joined).
pub async fn notify_game_created(state: &AppState, game_id: i64) {
    let gwp = match Game::find_with_players(&state.db, game_id).await {
        Ok(gwp) => gwp,
        Err(e) => {
            tracing::warn!("live::notify_game_created failed to load game {game_id}: {e}");
            return;
        }
    };

    let item = LiveGameItem::from_gwp(&gwp, None);
    let msg = json!({
        "kind": "game_created",
        "game": item,
    })
    .to_string();

    let _ = state.live_tx.send(msg);
}

/// Notify live clients that an existing game's state changed.
pub async fn notify_game_updated(state: &AppState, game_id: i64, move_count: Option<usize>) {
    let gwp = match Game::find_with_players(&state.db, game_id).await {
        Ok(gwp) => gwp,
        Err(e) => {
            tracing::warn!("live::notify_game_updated failed to load game {game_id}: {e}");
            return;
        }
    };

    let update = GameUpdate {
        id: gwp.game.id,
        stage: gwp.game.stage.clone(),
        result: gwp.game.result.clone(),
        black: gwp.black.as_ref().map(UserData::from),
        white: gwp.white.as_ref().map(UserData::from),
        move_count,
    };
    let msg = json!({
        "kind": "game_updated",
        "game": update,
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
