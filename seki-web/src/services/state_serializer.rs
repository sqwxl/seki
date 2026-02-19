use std::collections::HashSet;

use go_engine::{Engine, Point};
use serde_json::json;

use crate::models::game::GameWithPlayers;
use crate::services::clock::{self, ClockState, TimeControl};
use crate::templates::UserData;

pub struct TerritoryData {
    pub ownership: Vec<i8>,
    pub dead_stones: Vec<(u8, u8)>,
    pub score: go_engine::territory::GameScore,
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
    let score = go_engine::territory::score(engine.goban(), &ownership, dead_stones, komi);

    let mut dead_list: Vec<(u8, u8)> = dead_stones.iter().copied().collect();
    dead_list.sort();

    TerritoryData {
        ownership,
        dead_stones: dead_list,
        score,
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
    settled_score: Option<&go_engine::territory::GameScore>,
    clock: Option<(&ClockState, &TimeControl)>,
    online_users: &[i64],
) -> serde_json::Value {
    // Resolve stage: the engine derives stage from moves, but the DB is authoritative
    // for terminal states (done) and waiting states (unstarted with both users).
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

    let game_state = serde_json::to_value(engine.game_state()).unwrap_or_default();

    let mut val = json!({
        "kind": "state",
        "stage": stage.to_string(),
        "state": game_state,
        "negotiations": negotiations,
        "current_turn_stone": current_turn_stone,
        "moves": moves,
        "black": gwp.black.as_ref().map(UserData::from),
        "white": gwp.white.as_ref().map(UserData::from),
        "result": gwp.game.result,
        "undo_rejected": gwp.game.undo_rejected,
        "allow_undo": gwp.game.allow_undo
    });

    if let Some(t) = territory {
        let dead: Vec<_> = t.dead_stones.iter().map(|&(c, r)| json!([c, r])).collect();
        val["territory"] = json!({
            "ownership": t.ownership,
            "dead_stones": dead,
            "score": {
                "black": {
                    "territory": t.score.black.territory,
                    "captures": t.score.black.captures,
                },
                "white": {
                    "territory": t.score.white.territory,
                    "captures": t.score.white.captures,
                },
            },
            "black_approved": t.black_approved,
            "white_approved": t.white_approved,
        });
    }

    if territory.is_none()
        && let Some(gs) = settled_score
    {
        val["score"] = json!({
            "black": {
                "territory": gs.black.territory,
                "captures": gs.black.captures,
            },
            "white": {
                "territory": gs.white.territory,
                "captures": gs.white.captures,
            },
        });
    }

    if let Some((clock_state, time_control)) = clock {
        let active_stone = clock::active_stone_from_stage(&stage.to_string());
        val["clock"] = clock_state.to_json(time_control, active_stone);
    }

    val["online_users"] = json!(online_users);

    val
}

fn current_turn_stone(engine: &Engine) -> i32 {
    engine.current_turn_stone().to_int() as i32
}

/// Build the sender label for a chat message (e.g. "alice ●").
pub fn sender_label(gwp: &GameWithPlayers, user_id: i64, username: Option<&str>) -> String {
    use crate::models::game::{BLACK_SYMBOL, WHITE_SYMBOL};

    let symbol = if gwp.black.as_ref().is_some_and(|p| p.id == user_id) {
        BLACK_SYMBOL
    } else if gwp.white.as_ref().is_some_and(|p| p.id == user_id) {
        WHITE_SYMBOL
    } else {
        "?"
    };
    let name = username.unwrap_or("-");
    format!("{name} {symbol}")
}
