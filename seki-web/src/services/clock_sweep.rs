use std::time::Duration;

use chrono::Utc;
use go_engine::Stage;

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
            let update = clock.to_update(Some(active), &tc);
            if update.expires_at.is_some() {
                let _ = Game::update_clock(&state.db, game.id, &update).await;
            }
            continue;
        }

        tracing::info!(
            "Clock sweep: flagging game {} (active: {:?})",
            game.id,
            active
        );
        let gwp = match Game::find_with_players(&state.db, game.id).await {
            Ok(gwp) => gwp,
            Err(e) => {
                tracing::error!("Clock sweep: failed to load game {}: {e}", game.id);
                continue;
            }
        };
        if let Err(e) =
            game_actions::end_game_on_time(state, &gwp, active, clock, &tc, now).await
        {
            tracing::error!("Clock sweep: failed to end game {}: {e}", game.id);
        }
    }

    // Territory review sweep
    let tr_games = Game::find_expired_territory_reviews(&state.db).await?;

    for game in tr_games {
        let gwp = match Game::find_with_players(&state.db, game.id).await {
            Ok(gwp) => gwp,
            Err(e) => {
                tracing::error!(
                    "Territory review sweep: failed to load game {}: {e}",
                    game.id
                );
                continue;
            }
        };

        let engine = match state
            .registry
            .get_or_init_engine(&state.db, &gwp.game)
            .await
        {
            Ok(e) => e,
            Err(e) => {
                tracing::error!(
                    "Territory review sweep: failed to load engine for game {}: {e}",
                    game.id
                );
                continue;
            }
        };

        if engine.stage() != Stage::TerritoryReview {
            continue;
        }

        // Ensure territory review state exists (may have been lost on restart)
        if state
            .registry
            .get_territory_review(game.id)
            .await
            .is_none()
        {
            let dead_stones = go_engine::territory::detect_dead_stones(engine.goban());
            state
                .registry
                .init_territory_review(game.id, dead_stones)
                .await;
        }

        let tr = match state.registry.get_territory_review(game.id).await {
            Some(tr) => tr,
            None => continue,
        };

        tracing::info!(
            "Territory review sweep: settling game {}",
            game.id
        );
        if let Err(e) =
            game_actions::settle_territory(state, game.id, &gwp, &engine, &tr.dead_stones).await
        {
            tracing::error!(
                "Territory review sweep: failed to settle game {}: {e}",
                game.id
            );
        }
    }

    Ok(())
}
