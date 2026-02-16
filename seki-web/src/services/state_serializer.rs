use std::collections::HashSet;

use go_engine::{Engine, Point};
use serde_json::json;

use crate::models::game::GameWithPlayers;
use crate::services::clock::{ClockState, TimeControl};
use crate::templates::PlayerData;

pub struct TerritoryData {
    pub ownership: Vec<i8>,
    pub dead_stones: Vec<(u8, u8)>,
    pub black_score: f64,
    pub white_score: f64,
    pub black_approved: bool,
    pub white_approved: bool,
}

pub fn compute_territory_data(
    engine: &Engine,
    dead_stones: &HashSet<Point>,
    komi: f64,
    black_approved: bool,
    white_approved: bool,
) -> TerritoryData {
    let ownership = go_engine::territory::estimate_territory(engine.goban(), dead_stones);
    let (black_score, white_score) =
        go_engine::territory::score(engine.goban(), &ownership, dead_stones, komi);

    let mut dead_list: Vec<(u8, u8)> = dead_stones.iter().copied().collect();
    dead_list.sort();

    TerritoryData {
        ownership,
        dead_stones: dead_list,
        black_score,
        white_score,
        black_approved,
        white_approved,
    }
}

/// Serialize the full game state for sending to WebSocket clients.
pub fn serialize_state(
    gwp: &GameWithPlayers,
    engine: &Engine,
    undo_requested: bool,
    territory: Option<&TerritoryData>,
    clock: Option<(&ClockState, &TimeControl)>,
) -> serde_json::Value {
    // Resolve stage: the engine derives stage from moves, but the DB is authoritative
    // for terminal states (done) and waiting states (unstarted with both players).
    let stage = if gwp.game.result.is_some() {
        go_engine::Stage::Done
    } else if engine.stage() == go_engine::Stage::Unstarted && !gwp.is_open() {
        go_engine::Stage::BlackToPlay
    } else {
        engine.stage()
    };
    let current_turn_stone = current_turn_stone(engine);

    let mut negotiations = json!({});

    if undo_requested {
        negotiations["undo_request"] = json!({});
    }

    let moves: Vec<_> = engine
        .moves()
        .iter()
        .map(|t| serde_json::to_value(t).unwrap_or_default())
        .collect();

    let description = gwp.description_with_stage(&stage);

    let mut game_state = serde_json::to_value(engine.game_state()).unwrap_or_default();
    // Keep the nested state.stage in sync with the resolved top-level stage
    game_state["stage"] = json!(stage.to_string());

    let mut val = json!({
        "kind": "state",
        "stage": stage.to_string(),
        "state": game_state,
        "negotiations": negotiations,
        "current_turn_stone": current_turn_stone,
        "moves": moves,
        "black": gwp.black.as_ref().map(PlayerData::from),
        "white": gwp.white.as_ref().map(PlayerData::from),
        "result": gwp.game.result,
        "description": description,
        "undo_rejected": gwp.game.undo_rejected,
        "allow_undo": gwp.game.allow_undo
    });

    if let Some(t) = territory {
        let dead: Vec<_> = t.dead_stones.iter().map(|&(c, r)| json!([c, r])).collect();
        val["territory"] = json!({
            "ownership": t.ownership,
            "dead_stones": dead,
            "score": { "black": t.black_score, "white": t.white_score },
            "black_approved": t.black_approved,
            "white_approved": t.white_approved,
        });
    }

    if let Some((clock_state, time_control)) = clock {
        val["clock"] = clock_state.to_json(time_control);
    }

    val
}

fn current_turn_stone(engine: &Engine) -> i32 {
    engine.current_turn_stone().to_int() as i32
}

/// Build the sender label for a chat message (e.g. "alice ●").
pub fn sender_label(gwp: &GameWithPlayers, player_id: i64, username: Option<&str>) -> String {
    use crate::models::game::{BLACK_SYMBOL, WHITE_SYMBOL};

    let symbol = if gwp.black.as_ref().is_some_and(|p| p.id == player_id) {
        BLACK_SYMBOL
    } else if gwp.white.as_ref().is_some_and(|p| p.id == player_id) {
        WHITE_SYMBOL
    } else {
        "?"
    };
    let name = username.unwrap_or("-");
    format!("{name} {symbol}")
}
