use chrono::Utc;
use go_engine::{GoError, Stage};
use serde_json::json;

use crate::AppState;
use crate::error::AppError;
use crate::models::game::Game;
use crate::models::turn::TurnRow;
use crate::services::clock::{self, ClockState, TimeControl};

use super::{
    load_game_and_check_player, persist_clock, persist_stage, require_not_challenge,
    rollback_engine,
};

pub async fn request_undo(state: &AppState, game_id: i64, player_id: i64) -> Result<(), AppError> {
    let gwp = load_game_and_check_player(state, game_id, player_id).await?;
    require_not_challenge(&gwp)?;

    if gwp.game.result.is_some() {
        return Err(AppError::UnprocessableEntity(
            "The game is over".to_string(),
        ));
    }

    if !gwp.game.allow_undo {
        return Err(AppError::UnprocessableEntity(
            "Takebacks are not allowed in this game".into(),
        ));
    }

    if state.registry.is_undo_requested(game_id).await {
        return Err(AppError::UnprocessableEntity(
            "An undo request is already pending".to_string(),
        ));
    }

    if gwp.game.undo_rejected {
        return Err(AppError::UnprocessableEntity(
            "Undo was already rejected for the current move".to_string(),
        ));
    }

    let last_turn = TurnRow::last_turn(&state.db, game_id).await?;
    let last_turn =
        last_turn.ok_or_else(|| AppError::UnprocessableEntity("No turns to undo".to_string()))?;
    if last_turn.user_id != player_id {
        return Err(AppError::UnprocessableEntity(
            "Can only undo your own turn".to_string(),
        ));
    }
    state.registry.set_undo_requested(game_id, true).await;

    let requesting_name = gwp
        .player_by_id(player_id)
        .map(|u| u.display_name().to_string())
        .unwrap_or_else(|| "Unknown".to_string());
    let opponent = gwp.opponent_of(player_id).cloned();

    // Notify requester: disable undo button
    state
        .registry
        .send_to_player(
            game_id,
            player_id,
            &json!({ "kind": "undo_request_sent", "game_id": game_id }).to_string(),
        )
        .await;

    // Notify opponent: show accept/reject controls
    if let Some(opponent) = &opponent {
        state
            .registry
            .send_to_player(
                game_id,
                opponent.id,
                &json!({
                    "kind": "undo_response_needed",
                    "game_id": game_id,
                    "requesting_player": requesting_name,
                })
                .to_string(),
            )
            .await;
    }

    Ok(())
}

pub async fn respond_to_undo(
    state: &AppState,
    game_id: i64,
    player_id: i64,
    accept: bool,
) -> Result<(), AppError> {
    let mut gwp = load_game_and_check_player(state, game_id, player_id).await?;

    if !state.registry.is_undo_requested(game_id).await {
        return Err(AppError::UnprocessableEntity(
            "No pending undo request".to_string(),
        ));
    }

    // The requesting user is the one who played last (out of turn now)
    let engine = state
        .registry
        .get_or_init_engine(&state.db, &gwp.game)
        .await?;
    let requesting_player_id = gwp
        .out_of_turn_player(engine.current_turn_stone())
        .map(|p| p.id)
        .ok_or_else(|| AppError::Internal("Cannot determine requesting user".to_string()))?;

    if requesting_player_id == player_id {
        return Err(AppError::UnprocessableEntity(
            "Cannot respond to your own undo request".to_string(),
        ));
    }

    // Clear the in-memory request flag regardless of accept/reject
    state.registry.set_undo_requested(game_id, false).await;

    let (kind, engine) = if accept {
        // Mutate in-memory engine (same pattern as play_move)
        let engine = state
            .registry
            .with_engine_mut(game_id, |engine| {
                engine.pop_move().ok_or(GoError::NoMovesToUndo)?;
                Ok(())
            })
            .await;
        let engine = match engine {
            Some(Ok(engine)) => engine,
            Some(Err(e)) => return Err(AppError::UnprocessableEntity(e.to_string())),
            None => {
                return Err(AppError::Internal("Engine cache unavailable".into()));
            }
        };

        // If pop_move took us out of territory review, clean up stale state
        let left_territory_review = engine.stage() != Stage::TerritoryReview;

        // DB: DELETE last turn (returning clock snapshot), UPDATE stage, optionally restore clock
        let mut tx = state.db.begin().await?;
        let deleted_turn = match TurnRow::delete_last_returning(&mut *tx, game_id).await {
            Ok(turn) => turn,
            Err(e) => {
                rollback_engine(state, game_id, &gwp.game).await;
                return Err(AppError::Internal(e.to_string()));
            }
        };
        persist_stage(&mut *tx, game_id, &engine).await?;

        // Restore clock from snapshot if available
        if let Some(ref turn) = deleted_turn
            && let (Some(bms), Some(wms), Some(bp), Some(wp)) = (
                turn.clock_black_ms,
                turn.clock_white_ms,
                turn.clock_black_periods,
                turn.clock_white_periods,
            )
        {
            let restored_clock = ClockState {
                black_remaining_ms: bms,
                white_remaining_ms: wms,
                black_periods: bp,
                white_periods: wp,
                last_move_at: Some(Utc::now()),
            };
            let tc = TimeControl::from_game(&gwp.game);
            let stage_str = engine.stage().to_string();
            let new_active = clock::active_stone_from_stage(&stage_str);
            persist_clock(state, &mut *tx, game_id, &restored_clock, &tc, new_active).await?;
        }

        if left_territory_review {
            Game::clear_territory_review_deadline(&mut *tx, game_id).await?;
        }
        tx.commit().await?;

        // Clear in-memory territory review state only after the transaction
        // succeeds, so rollback_engine won't leave inconsistent state.
        if left_territory_review {
            state.registry.clear_territory_review(game_id).await;
        }

        ("undo_accepted", engine)
    } else {
        Game::set_undo_rejected(&state.db, game_id, true).await?;
        gwp.game.undo_rejected = true;
        ("undo_rejected", engine)
    };

    // Build response directly from engine data (no serialize_state overhead)
    let game_state_json = serde_json::to_value(engine.game_state()).unwrap_or_default();
    let moves_json: Vec<serde_json::Value> = engine
        .moves()
        .iter()
        .map(|t| serde_json::to_value(t).unwrap_or_default())
        .collect();
    let current_turn_stone = engine.current_turn_stone().to_int() as i32;

    // Include clock data so the client can sync the active player's clock
    let tc = TimeControl::from_game(&gwp.game);
    let clock_json = if !tc.is_none() {
        let stage_str = engine.stage().to_string();
        let active_stone = clock::active_stone_from_stage(&stage_str);
        state
            .registry
            .get_clock(game_id)
            .await
            .map(|c| c.to_json(&tc, active_stone))
    } else {
        None
    };

    let mut msg_val = json!({
        "kind": kind,
        "game_id": game_id,
        "state": game_state_json,
        "current_turn_stone": current_turn_stone,
        "moves": moves_json,
        "undo_rejected": gwp.game.undo_rejected,
    });
    if let Some(clock) = clock_json {
        msg_val["clock"] = clock;
    }
    let msg = msg_val.to_string();

    for pid in [requesting_player_id, player_id] {
        state.registry.send_to_player(game_id, pid, &msg).await;
    }

    Ok(())
}
