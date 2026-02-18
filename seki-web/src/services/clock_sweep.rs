use std::time::Duration;

use chrono::Utc;

use crate::AppState;
use crate::models::game::Game;
use crate::services::clock::{self, ClockState, TimeControl};
use crate::services::game_actions;

/// Periodic safety-net sweep that ends games whose clocks have expired.
/// Runs every 5 seconds, catches games where the client didn't send a timeout_flag
/// (e.g. both users disconnected, or client crashed).
pub async fn run(state: AppState) {
    let mut interval = tokio::time::interval(Duration::from_secs(5));
    loop {
        interval.tick().await;
        if let Err(e) = sweep(&state).await {
            tracing::error!("Clock sweep error: {e}");
        }
    }
}

async fn sweep(state: &AppState) -> Result<(), Box<dyn std::error::Error>> {
    let games = Game::find_expired_clocks(&state.db).await?;
    let now = Utc::now();

    for game in games {
        let tc = TimeControl::from_game(&game);
        if tc.is_none() {
            continue;
        }

        let clock = match ClockState::from_game(&game) {
            Some(c) => c,
            None => continue,
        };

        let Some(active) = clock::active_stone_from_stage(&game.stage) else {
            continue;
        };

        if !clock.is_flagged(active, Some(active), &tc, now) {
            // clock_expires_at was approximate; not truly expired yet — update it
            if let Some(expires_at) = clock.expiration(Some(active), &tc, now) {
                let _ = Game::update_clock(
                    &state.db,
                    game.id,
                    clock.black_remaining_ms,
                    clock.white_remaining_ms,
                    clock.black_periods,
                    clock.white_periods,
                    Some(active.to_int() as i32),
                    clock.last_move_at,
                    Some(expires_at),
                )
                .await;
            }
            continue;
        }

        tracing::info!("Clock sweep: flagging game {} (active: {:?})", game.id, active);
        if let Err(e) =
            game_actions::end_game_on_time(state, game.id, &game, active, clock, &tc, now).await
        {
            tracing::error!("Clock sweep: failed to end game {}: {e}", game.id);
        }
    }

    Ok(())
}
