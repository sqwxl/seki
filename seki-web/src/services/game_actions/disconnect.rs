use crate::AppState;
use crate::error::AppError;

use super::{load_game_and_check_player, pause_clock, player_stone, require_both_players};

/// Claim victory because the opponent disconnected and the grace period expired.
/// Requires the opponent to be marked as "gone" in the registry.
pub async fn claim_victory(state: &AppState, game_id: i64, player_id: i64) -> Result<(), AppError> {
    let mut gwp = load_game_and_check_player(state, game_id, player_id).await?;
    require_both_players(&gwp)?;

    if gwp.game.result.is_some() {
        return Err(AppError::UnprocessableEntity(
            "The game is over".to_string(),
        ));
    }

    // Find the opponent
    let opponent_id = gwp
        .opponent_of(player_id)
        .map(|u| u.id)
        .ok_or_else(|| AppError::UnprocessableEntity("Cannot determine opponent".to_string()))?;

    // Verify opponent is "gone" (grace period expired)
    if !state.registry.is_player_gone(game_id, opponent_id).await {
        return Err(AppError::UnprocessableEntity(
            "Opponent has not been gone long enough to claim victory".to_string(),
        ));
    }

    let stone = player_stone(&gwp, player_id)?;
    let result = match stone {
        go_engine::Stone::Black => "B+R",
        go_engine::Stone::White => "W+R",
    };

    // Persist all DB writes in a transaction
    let mut tx = state.db.begin().await?;
    pause_clock(state, &mut *tx, game_id, &gwp.game).await?;
    crate::models::game::Game::set_ended(&mut *tx, game_id, result, "completed").await?;
    tx.commit().await?;

    crate::services::live::notify_game_removed(state, game_id);

    let opponent_left_msg = format!("Opponent left the game. {result}");
    super::end_game::finalize_and_broadcast(
        state,
        &mut gwp,
        game_id,
        result,
        &[&opponent_left_msg],
    )
    .await;

    Ok(())
}
