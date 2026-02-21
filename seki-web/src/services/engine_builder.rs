use std::str::FromStr;

use go_engine::{Engine, GameState, Move, Stone, Turn};

use crate::db::DbPool;
use crate::models::game::Game;
use crate::models::turn::TurnRow;

pub(crate) fn game_handicap(game: &Game) -> u8 {
    game.handicap as u8
}

/// Build an Engine from the database state of a game. Uses cached_engine_state when the turn count matches.
pub async fn build_engine(pool: &DbPool, game: &Game) -> Result<Engine, sqlx::Error> {
    let db_turns = TurnRow::find_by_game_id(pool, game.id).await?;
    let turn_count = db_turns.len() as i64;
    let handicap = game_handicap(game);

    // Check cache
    if turn_count > 0
        && let Some(ref cached) = game.cached_engine_state
        && let Ok(value) = serde_json::from_str::<serde_json::Value>(cached)
        && value.get("turn_count").and_then(|v| v.as_i64()) == Some(turn_count)
        && value.get("handicap").and_then(|v| v.as_u64()) == Some(handicap as u64)
        && let Ok(gs) = serde_json::from_value::<GameState>(value)
    {
        let turns = convert_turns(&db_turns);
        return Ok(Engine::from_game_state(
            game.cols as u8,
            game.rows as u8,
            handicap,
            turns,
            gs,
        ));
    }

    // Build from scratch
    let turns = convert_turns(&db_turns);
    let engine = Engine::with_handicap_and_moves(game.cols as u8, game.rows as u8, handicap, turns);

    // Cache the result
    cache_engine_state(pool, game.id, &engine, turn_count, None).await?;

    Ok(engine)
}

pub async fn cache_engine_state(
    executor: impl sqlx::PgExecutor<'_>,
    game_id: i64,
    engine: &Engine,
    turn_count: i64,
    metadata: Option<serde_json::Value>,
) -> Result<(), sqlx::Error> {
    let mut state = serde_json::to_value(engine.game_state()).unwrap_or_default();
    if let serde_json::Value::Object(ref mut map) = state {
        map.insert(
            "turn_count".to_string(),
            serde_json::Value::Number(serde_json::Number::from(turn_count)),
        );
        map.insert(
            "handicap".to_string(),
            serde_json::Value::Number(serde_json::Number::from(engine.handicap())),
        );
        if let Some(serde_json::Value::Object(meta_map)) = metadata {
            for (k, v) in meta_map {
                map.insert(k, v);
            }
        }
    }

    let json_str = serde_json::to_string(&state).unwrap_or_default();
    Game::update_cached_engine_state(executor, game_id, &json_str).await
}

pub(crate) fn convert_turns(db_turns: &[TurnRow]) -> Vec<Turn> {
    db_turns
        .iter()
        .map(|t| {
            let stone = Stone::from_int(t.stone as i8).expect("user stone must be Black or White");
            let kind = Move::from_str(&t.kind).unwrap_or(Move::Play);
            match kind {
                Move::Play => {
                    let point = (t.col.unwrap_or(0) as u8, t.row.unwrap_or(0) as u8);
                    Turn::play(stone, point)
                }
                Move::Pass => Turn::pass(stone),
                Move::Resign => Turn::resign(stone),
            }
        })
        .collect()
}
