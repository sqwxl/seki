use std::collections::HashSet;

use chrono::Utc;
use go_engine::{Engine, Stage};
use serde_json::json;

use crate::AppState;
use crate::error::AppError;
use crate::models::game::{Game, GameWithPlayers};

use super::{
    broadcast_game_state, broadcast_system_chat, load_game_and_check_player, pause_clock,
    player_stone, require_both_players, require_not_challenge,
};

pub async fn toggle_chain(
    state: &AppState,
    game_id: i64,
    player_id: i64,
    col: u8,
    row: u8,
) -> Result<(), AppError> {
    let mut gwp = load_game_and_check_player(state, game_id, player_id).await?;
    require_both_players(&gwp)?;
    require_not_challenge(&gwp)?;

    let engine = state
        .registry
        .get_or_init_engine(&state.db, &gwp.game)
        .await?;

    require_territory_review(&engine, state, &gwp, game_id, player_id).await?;

    state
        .registry
        .toggle_dead_chain(game_id, (col, row), engine.goban())
        .await
        .ok_or_else(|| AppError::Internal("Territory review state not found".to_string()))?;

    let _ = Game::clear_territory_review_deadline(&state.db, game_id).await;
    gwp.game.territory_review_expires_at = None;

    broadcast_game_state(state, &gwp, &engine).await;
    Ok(())
}

pub async fn approve_territory(
    state: &AppState,
    game_id: i64,
    player_id: i64,
) -> Result<(), AppError> {
    let mut gwp = load_game_and_check_player(state, game_id, player_id).await?;
    require_both_players(&gwp)?;
    require_not_challenge(&gwp)?;
    let stone = player_stone(&gwp, player_id)?;

    let engine = state
        .registry
        .get_or_init_engine(&state.db, &gwp.game)
        .await?;

    require_territory_review(&engine, state, &gwp, game_id, player_id).await?;

    // Check if already approved
    if let Some(tr) = state.registry.get_territory_review(game_id).await {
        let already_approved = match stone {
            go_engine::Stone::Black => tr.black_approved,
            go_engine::Stone::White => tr.white_approved,
        };
        if already_approved {
            return Err(AppError::UnprocessableEntity(
                "You have already approved the territory".to_string(),
            ));
        }
    }

    state.registry.set_approved(game_id, stone, true).await;

    let tr = state
        .registry
        .get_territory_review(game_id)
        .await
        .ok_or_else(|| AppError::Internal("Territory review state not found".to_string()))?;

    if tr.black_approved && tr.white_approved {
        Game::clear_territory_review_deadline(&state.db, game_id).await?;
        settle_territory(state, game_id, gwp, &engine, &tr.dead_stones).await?;
    } else if tr.black_approved || tr.white_approved {
        let deadline = Utc::now() + chrono::Duration::seconds(60);
        Game::set_territory_review_deadline(&state.db, game_id, deadline).await?;
        gwp.game.territory_review_expires_at = Some(deadline);
        broadcast_game_state(state, &gwp, &engine).await;
    } else {
        broadcast_game_state(state, &gwp, &engine).await;
    }

    Ok(())
}

pub async fn settle_territory(
    state: &AppState,
    game_id: i64,
    mut gwp: GameWithPlayers,
    engine: &Engine,
    dead_stones: &HashSet<go_engine::Point>,
) -> Result<(), AppError> {
    let ownership = go_engine::territory::estimate_territory(engine.goban(), dead_stones);
    let gs = go_engine::territory::score(engine.goban(), &ownership, dead_stones, gwp.game.komi);
    let result = gs.result();

    let dead_json: Vec<serde_json::Value> =
        dead_stones.iter().map(|&(c, r)| json!([c, r])).collect();
    let dead_json_str = serde_json::to_string(&dead_json)?;

    // Persist all DB writes in a transaction
    let mut tx = state.db.begin().await?;

    pause_clock(state, &mut *tx, game_id, &gwp.game).await?;

    Game::clear_territory_review_deadline(&mut *tx, game_id).await?;

    sqlx::query(
        "INSERT INTO territory_reviews \
         (game_id, settled, dead_stones, black_territory, black_captures, white_territory, white_captures) \
         VALUES ($1, TRUE, $2::jsonb, $3, $4, $5, $6)",
    )
    .bind(game_id)
    .bind(&dead_json_str)
    .bind(gs.black.territory as i32)
    .bind(gs.black.captures as i32)
    .bind(gs.white.territory as i32)
    .bind(gs.white.captures as i32)
    .execute(&mut *tx)
    .await?;

    Game::set_ended(&mut *tx, game_id, &result, "completed").await?;

    tx.commit().await?;

    // Non-transactional post-actions
    state
        .registry
        .with_engine_mut(game_id, |engine| {
            engine.set_result(result.clone());
            Ok(())
        })
        .await;

    let engine = state
        .registry
        .get_engine(game_id)
        .await
        .ok_or_else(|| AppError::Internal("Engine cache unavailable".to_string()))?;

    state.registry.clear_territory_review(game_id).await;

    gwp.game.result = Some(result.clone());
    gwp.game.stage = "completed".to_string();

    broadcast_system_chat(
        state,
        game_id,
        &format!("Game over. {result}"),
        Some(engine.moves().len() as i32),
    )
    .await;
    broadcast_game_state(state, &gwp, &engine).await;

    Ok(())
}

async fn require_territory_review(
    engine: &Engine,
    state: &AppState,
    gwp: &GameWithPlayers,
    game_id: i64,
    player_id: i64,
) -> Result<(), AppError> {
    if engine.stage() != Stage::TerritoryReview {
        return Err(AppError::UnprocessableEntity(
            "Not in territory review".to_string(),
        ));
    }
    if let Some(opp) = gwp.opponent_of(player_id)
        && state.registry.is_player_disconnected(game_id, opp.id).await
    {
        return Err(AppError::UnprocessableEntity(
            "Opponent disconnected, territory review paused".to_string(),
        ));
    }
    Ok(())
}
