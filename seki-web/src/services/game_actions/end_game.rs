use go_engine::Stone;

use crate::AppState;
use crate::error::AppError;
use crate::models::game::Game;
use crate::services::clock::{ClockState, TimeControl};

use super::{broadcast_game_state, broadcast_system_chat, persist_clock};

/// End a game due to time expiration. Used by both client flag and server sweep.
pub async fn end_game_on_time(
    state: &AppState,
    mut gwp: crate::models::game::GameWithPlayers,
    flagged_stone: Stone,
    mut clock: ClockState,
    tc: &TimeControl,
    now: chrono::DateTime<chrono::Utc>,
) -> Result<(), AppError> {
    let game_id = gwp.game.id;
    let winner = flagged_stone.opp();
    let result = match winner {
        Stone::Black => "B+T",
        Stone::White => "W+T",
    };

    clock.pause(Some(flagged_stone), now);

    // Persist all DB writes in a transaction
    let mut tx = state.db.begin().await?;
    let ended = Game::set_ended(&mut *tx, game_id, result, "completed").await?;
    persist_clock(state, &mut *tx, game_id, &clock, tc, None).await?;
    tx.commit().await?;

    if !ended {
        return Ok(());
    }

    finalize_and_broadcast(state, &mut gwp, game_id, result, &[]).await;

    Ok(())
}

/// Shared post-game finalization: rating, engine result, broadcast.
/// Used by resign, territory settlement, disconnect claim, and timeout.
pub(super) async fn finalize_and_broadcast(
    state: &AppState,
    gwp: &mut crate::models::game::GameWithPlayers,
    game_id: i64,
    result: &str,
    extra_system_chats: &[&str],
) {
    // Rating finalization
    if let Some(b_id) = gwp.game.black_id
        && let Some(w_id) = gwp.game.white_id
        && let Err(e) =
            crate::services::rating::finalize_rating(&state.db, &gwp.game, result, b_id, w_id).await
    {
        tracing::error!(game_id, error = %e, "Failed to finalize rating");
    }

    let _ = state
        .registry
        .with_engine_mut(game_id, |e| {
            e.set_result(result.to_string());
            Ok(())
        })
        .await;

    gwp.game.result = Some(result.to_string());
    gwp.game.stage = "completed".to_string();

    let engine = match state.registry.get_engine(game_id).await {
        Some(e) => e,
        None => {
            tracing::error!(game_id, "Engine not found after game end");
            return;
        }
    };

    let move_number = Some(engine.moves().len() as i32);

    for chat in extra_system_chats {
        broadcast_system_chat(state, game_id, chat, move_number).await;
    }
    broadcast_system_chat(state, game_id, &format!("Game over. {result}"), move_number).await;
    broadcast_game_state(state, gwp, &engine).await;
}
