use go_engine::{Engine, Stage};

use crate::AppState;
use crate::error::AppError;
use crate::models::game::Game;
use crate::models::turn::TurnRow;
use crate::services::live;

use super::{
    apply_engine_mutation, broadcast_game_state, broadcast_system_chat, load_game_and_check_player,
    pause_clock, player_stone, require_both_players, require_not_challenge, rollback_engine,
};

pub async fn resign(state: &AppState, game_id: i64, player_id: i64) -> Result<Engine, AppError> {
    let mut gwp = load_game_and_check_player(state, game_id, player_id).await?;
    require_both_players(&gwp)?;
    require_not_challenge(&gwp)?;

    if gwp.game.result.is_some() {
        return Err(AppError::UnprocessableEntity(
            "The game is over".to_string(),
        ));
    }

    // Cannot resign before first move - use abort instead
    let engine = state
        .registry
        .get_or_init_engine(&state.db, &gwp.game)
        .await?;
    if engine.moves().is_empty() {
        return Err(AppError::UnprocessableEntity(
            "Cannot resign before the first move. Use abort instead.".to_string(),
        ));
    }

    let stone = player_stone(&gwp, player_id)?;

    let engine = apply_engine_mutation(state, game_id, &gwp.game, |engine| {
        engine.try_resign(stone);
        Ok(())
    })
    .await?;

    if engine.stage() == Stage::Completed {
        let mut tx = state.db.begin().await?;

        pause_clock(state, &mut *tx, game_id, &gwp.game).await?;

        let move_number = engine.moves().len() as i32;
        if let Err(e) = TurnRow::create(
            &mut *tx,
            game_id,
            player_id,
            move_number,
            "resign",
            stone.to_int() as i32,
            None,
            None,
            None,
        )
        .await
        {
            rollback_engine(state, game_id, &gwp.game).await;
            return Err(AppError::Internal(e.to_string()));
        }

        let ended = if let Some(result) = engine.result() {
            Game::set_ended(&mut *tx, game_id, result, "completed").await?
        } else {
            false
        };

        tx.commit().await?;

        if engine.stage() == Stage::Completed
            && let Some(result) = engine.result()
            && let Some(b_id) = gwp.game.black_id
            && let Some(w_id) = gwp.game.white_id
            && let Err(e) =
                crate::services::rating::finalize_rating(&state.db, &gwp.game, result, b_id, w_id)
                    .await
        {
            tracing::error!(
                game_id,
                error = %e,
                "Failed to finalize rating after resign"
            );
        }

        if ended {
            gwp.game.result = engine.result().map(String::from);
            gwp.game.stage = "completed".to_string();
        }
    }

    broadcast_game_state(state, &gwp, &engine).await;

    if gwp.game.result.is_some()
        && let Some(result) = engine.result()
    {
        let move_number = Some(engine.moves().len() as i32);
        broadcast_system_chat(state, game_id, &format!("Game over. {result}"), move_number).await;
    }

    Ok(engine)
}

pub async fn abort(state: &AppState, game_id: i64, player_id: i64) -> Result<(), AppError> {
    let mut gwp = load_game_and_check_player(state, game_id, player_id).await?;

    if gwp.game.result.is_some() {
        return Err(AppError::UnprocessableEntity(
            "The game is over".to_string(),
        ));
    }

    let engine = state
        .registry
        .get_or_init_engine(&state.db, &gwp.game)
        .await?;
    if !engine.moves().is_empty() {
        return Err(AppError::UnprocessableEntity(
            "Cannot abort after the first move".to_string(),
        ));
    }

    // Only creator can abort before first move
    if gwp.game.creator_id != Some(player_id) {
        return Err(AppError::UnprocessableEntity(
            "Only the game creator can abort".to_string(),
        ));
    }

    // Persist all DB writes in a transaction
    let mut tx = state.db.begin().await?;
    pause_clock(state, &mut *tx, game_id, &gwp.game).await?;
    Game::set_ended(&mut *tx, game_id, "Aborted", "aborted").await?;
    tx.commit().await?;

    gwp.game.result = Some("Aborted".to_string());
    gwp.game.stage = "aborted".to_string();

    live::notify_game_removed(state, game_id);

    // Update engine cache
    let _ = state
        .registry
        .with_engine_mut(game_id, |engine| {
            engine.set_result("Aborted".to_string());
            Ok(())
        })
        .await;

    let username = gwp
        .player_by_id(player_id)
        .map(|u| u.username.as_str())
        .unwrap_or("Unknown");
    broadcast_system_chat(state, game_id, &format!("Game aborted by {username}"), None).await;

    if let Some(engine) = state.registry.get_engine(game_id).await {
        broadcast_game_state(state, &gwp, &engine).await;
    } else {
        tracing::warn!("abort: engine not cached for broadcast");
    }

    Ok(())
}
