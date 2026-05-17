use go_engine::{Engine, Stage};

use crate::AppState;
use crate::error::AppError;
use crate::models::game::Game;
use crate::models::turn::{ClockSnapshot, TurnRow};
use crate::services::clock::TimeControl;

use super::{
    ClockMoveParams, apply_engine_mutation, broadcast_game_state, load_game_and_check_player,
    load_or_init_clock, pause_clock, persist_stage, player_stone, process_clock_after_move,
    require_both_players, require_not_challenge, rollback_engine,
};

pub async fn play_move(
    state: &AppState,
    game_id: i64,
    player_id: i64,
    col: i32,
    row: i32,
    client_move_time_ms: Option<i64>,
) -> Result<Engine, AppError> {
    if col < 0 || row < 0 {
        return Err(AppError::UnprocessableEntity(
            "Invalid coordinates".to_string(),
        ));
    }

    let mut gwp = load_game_and_check_player(state, game_id, player_id).await?;
    require_both_players(&gwp)?;
    require_not_challenge(&gwp)?;

    if gwp.game.result.is_some() {
        return Err(AppError::UnprocessableEntity(
            "The game is over".to_string(),
        ));
    }

    // Cannot play during territory review
    let engine = state
        .registry
        .get_or_init_engine(&state.db, &gwp.game)
        .await?;
    if engine.stage() == Stage::TerritoryReview {
        return Err(AppError::UnprocessableEntity(
            "Cannot play moves during territory review".to_string(),
        ));
    }

    let stone = player_stone(&gwp, player_id)?;

    let engine = apply_engine_mutation(state, game_id, &gwp.game, |engine| {
        engine.try_play(stone, (col as u8, row as u8)).map(|_| ())
    })
    .await?;

    // Capture clock state before processing the move
    let clock_snapshot = {
        let tc = TimeControl::from_game(&gwp.game);
        if !tc.is_none() {
            load_or_init_clock(state, game_id, &gwp.game)
                .await
                .ok()
                .map(|c| ClockSnapshot {
                    black_ms: c.black_remaining_ms,
                    white_ms: c.white_remaining_ms,
                    black_periods: c.black_periods,
                    white_periods: c.white_periods,
                })
        } else {
            None
        }
    };

    // Persist all DB writes in a transaction
    let mut tx = state.db.begin().await?;

    let move_number = (engine.moves().len() - 1) as i32;
    if let Err(e) = TurnRow::create(
        &mut *tx,
        game_id,
        player_id,
        move_number,
        "play",
        stone.to_int() as i32,
        Some(col),
        Some(row),
        clock_snapshot.as_ref(),
    )
    .await
    {
        rollback_engine(state, game_id, &gwp.game).await;
        return Err(AppError::Internal(e.to_string()));
    }

    let first_move = gwp.game.started_at.is_none();
    if first_move {
        Game::set_started(&mut *tx, game_id).await?;
    }

    process_clock_after_move(
        state,
        &mut *tx,
        game_id,
        &gwp.game,
        ClockMoveParams {
            stone,
            first_move,
            player_id,
            client_move_time_ms,
        },
    )
    .await?;
    persist_stage(&mut *tx, game_id, &engine).await?;

    if gwp.game.undo_rejected {
        Game::set_undo_rejected(&mut *tx, game_id, false).await?;
        gwp.game.undo_rejected = false;
    }

    tx.commit().await?;

    // Non-transactional post-actions
    state.registry.set_undo_requested(game_id, false).await;
    broadcast_game_state(state, &gwp, &engine).await;

    Ok(engine)
}

pub async fn pass(
    state: &AppState,
    game_id: i64,
    player_id: i64,
    client_move_time_ms: Option<i64>,
) -> Result<Engine, AppError> {
    let mut gwp = load_game_and_check_player(state, game_id, player_id).await?;
    require_both_players(&gwp)?;
    require_not_challenge(&gwp)?;

    if gwp.game.result.is_some() {
        return Err(AppError::UnprocessableEntity(
            "The game is over".to_string(),
        ));
    }

    // Cannot pass during territory review
    let engine = state
        .registry
        .get_or_init_engine(&state.db, &gwp.game)
        .await?;
    if engine.stage() == Stage::TerritoryReview {
        return Err(AppError::UnprocessableEntity(
            "Cannot pass during territory review".to_string(),
        ));
    }

    let stone = player_stone(&gwp, player_id)?;

    let engine = apply_engine_mutation(state, game_id, &gwp.game, |engine| {
        engine.try_pass(stone).map(|_| ())
    })
    .await?;

    // Capture clock state before processing the move
    let clock_snapshot = {
        let tc = TimeControl::from_game(&gwp.game);
        if !tc.is_none() {
            load_or_init_clock(state, game_id, &gwp.game)
                .await
                .ok()
                .map(|c| ClockSnapshot {
                    black_ms: c.black_remaining_ms,
                    white_ms: c.white_remaining_ms,
                    black_periods: c.black_periods,
                    white_periods: c.white_periods,
                })
        } else {
            None
        }
    };

    // Persist all DB writes in a transaction
    let mut tx = state.db.begin().await?;

    let move_number = (engine.moves().len() - 1) as i32;
    if let Err(e) = TurnRow::create(
        &mut *tx,
        game_id,
        player_id,
        move_number,
        "pass",
        stone.to_int() as i32,
        None,
        None,
        clock_snapshot.as_ref(),
    )
    .await
    {
        rollback_engine(state, game_id, &gwp.game).await;
        return Err(AppError::Internal(e.to_string()));
    }

    process_clock_after_move(
        state,
        &mut *tx,
        game_id,
        &gwp.game,
        ClockMoveParams {
            stone,
            first_move: false,
            player_id,
            client_move_time_ms,
        },
    )
    .await?;
    persist_stage(&mut *tx, game_id, &engine).await?;

    if gwp.game.undo_rejected {
        Game::set_undo_rejected(&mut *tx, game_id, false).await?;
        gwp.game.undo_rejected = false;
    }

    // Pause clock if entering territory review
    if engine.stage() == Stage::TerritoryReview {
        pause_clock(state, &mut *tx, game_id, &gwp.game).await?;
    }

    tx.commit().await?;

    // Non-transactional post-actions
    state.registry.set_undo_requested(game_id, false).await;

    if engine.stage() == Stage::TerritoryReview {
        let dead_stones = go_engine::territory::detect_dead_stones(engine.goban());
        state
            .registry
            .init_territory_review(game_id, dead_stones)
            .await;
    }

    broadcast_game_state(state, &gwp, &engine).await;

    Ok(engine)
}
