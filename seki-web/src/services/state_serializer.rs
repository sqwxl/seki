use go_engine::{Engine, Stage};
use serde_json::json;

use crate::models::game::GameWithPlayers;

/// Serialize the full game state for sending to WebSocket clients.
pub fn serialize_state(gwp: &GameWithPlayers, engine: &Engine) -> serde_json::Value {
    let stage = game_stage(gwp);
    let current_turn_stone = current_turn_stone(gwp, engine);

    let mut negotiations = json!({});

    if gwp.has_pending_undo_request() {
        if let Some(ref urp) = gwp.undo_requesting_player {
            negotiations["undo_request"] = json!({
                "requesting_player": urp.display_name()
            });
        }
    }

    json!({
        "stage": stage.to_string(),
        "state": serde_json::to_value(engine.game_state()).unwrap_or_default(),
        "negotiations": negotiations,
        "current_turn_stone": current_turn_stone
    })
}

/// Determine game stage — uses the DB column, no engine needed.
pub fn game_stage(gwp: &GameWithPlayers) -> Stage {
    gwp.game.stage.parse().unwrap_or(Stage::Unstarted)
}

fn current_turn_stone(_gwp: &GameWithPlayers, engine: &Engine) -> i32 {
    engine.current_turn_stone().to_int() as i32
}

/// Build the sender label for a chat message (e.g. "B (alice)").
pub fn sender_label(gwp: &GameWithPlayers, player_id: i64, username: Option<&str>) -> String {
    let stone_letter = if gwp.black.as_ref().is_some_and(|p| p.id == player_id) {
        "B"
    } else if gwp.white.as_ref().is_some_and(|p| p.id == player_id) {
        "W"
    } else {
        "S"
    };
    let name = username.unwrap_or("-");
    format!("{stone_letter} ({name})")
}
