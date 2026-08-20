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

        // Apply flag grace from lag compensation (if tracker exists in memory)
        let active_player_id = match active {
            go_engine::Stone::Black => game.black_id,
            go_engine::Stone::White => game.white_id,
        };
        let grace_ms = match active_player_id {
            Some(pid) => state.registry.flag_grace_ms(game.id, pid).await,
            None => 0,
        };

        if !clock.is_flagged_with_grace(active, &tc, now, grace_ms) {
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
        let game_id = game.id;
        let gwp = match game.with_players(&state.db).await {
            Ok(gwp) => gwp,
            Err(e) => {
                tracing::error!("Clock sweep: failed to load players for game {game_id}: {e}");
                continue;
            }
        };
        if let Err(e) = game_actions::end_game_on_time(state, gwp, active, clock, &tc, now).await {
            tracing::error!("Clock sweep: failed to end game {game_id}: {e}");
        }
    }

    // Territory review sweep
    let tr_games = Game::find_expired_territory_reviews(&state.db).await?;

    for game in tr_games {
        let game_id = game.id;
        let gwp = match game.with_players(&state.db).await {
            Ok(gwp) => gwp,
            Err(e) => {
                tracing::error!(
                    "Territory review sweep: failed to load players for game {game_id}: {e}"
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
                    "Territory review sweep: failed to load engine for game {game_id}: {e}"
                );
                continue;
            }
        };

        if engine.stage() != Stage::TerritoryReview {
            continue;
        }

        // Ensure territory review state exists (may have been lost on restart)
        if state.registry.get_territory_review(game_id).await.is_none() {
            let dead_stones = go_engine::territory::detect_dead_stones(engine.goban());
            state
                .registry
                .init_territory_review(game_id, dead_stones)
                .await;
        }

        let tr = match state.registry.get_territory_review(game_id).await {
            Some(tr) => tr,
            None => continue,
        };

        tracing::info!("Territory review sweep: settling game {game_id}");
        if let Err(e) =
            game_actions::settle_territory(state, game_id, gwp, &engine, &tr.dead_stones).await
        {
            tracing::error!("Territory review sweep: failed to settle game {game_id}: {e}");
        }
    }

    // Correspondence turn reminders
    if let Err(e) = sweep_corr_reminders(state).await {
        tracing::error!("Correspondence reminder sweep error: {e}");
    }

    Ok(())
}

/// Emails the active player once when their correspondence clock enters the
/// final 12 hours. Fires per entry into the window, not per turn: an undo
/// that restores the clock above the threshold re-arms it.
pub const CORR_REMINDER_THRESHOLD_MS: i64 = 12 * 60 * 60 * 1000;

fn should_send_corr_reminder(remaining_ms: i64, last_seen_ms: Option<i64>) -> bool {
    remaining_ms <= CORR_REMINDER_THRESHOLD_MS
        && (last_seen_ms.is_none()
            || last_seen_ms.is_some_and(|last| last > CORR_REMINDER_THRESHOLD_MS)
            || remaining_ms > last_seen_ms.unwrap_or(i64::MAX))
}

async fn sweep_corr_reminders(state: &AppState) -> Result<(), Box<dyn std::error::Error>> {
    let games = Game::find_active_correspondence_games(&state.db).await?;

    for game in games {
        let Some(active) = clock::active_stone_from_stage(&game.stage) else {
            continue;
        };
        let remaining = match active {
            go_engine::Stone::Black => game.clock_black_ms,
            go_engine::Stone::White => game.clock_white_ms,
        };
        let Some(remaining) = remaining else { continue };
        if remaining <= 0 {
            continue;
        }

        let fire = should_send_corr_reminder(remaining, game.corr_reminder_last_seen_ms);

        Game::set_corr_reminder_last_seen(&state.db, game.id, remaining).await?;

        if fire {
            send_corr_reminder(state, &game, active).await;
        }
    }

    Ok(())
}

async fn send_corr_reminder(state: &AppState, game: &Game, active: go_engine::Stone) {
    let (active_id, opponent_id) = match active {
        go_engine::Stone::Black => (game.black_id, game.white_id),
        go_engine::Stone::White => (game.white_id, game.black_id),
    };
    let (Some(active_id), Some(opponent_id)) = (active_id, opponent_id) else {
        return;
    };
    let (Ok(recipient), Ok(opponent)) = (
        crate::models::user::User::find_by_id(&state.db, active_id).await,
        crate::models::user::User::find_by_id(&state.db, opponent_id).await,
    ) else {
        return;
    };
    let Some(email) = recipient.email.as_deref() else {
        return;
    };

    let enabled = recipient
        .preferences
        .get("notify_your_turn_corr_email")
        .and_then(|value| value.as_bool())
        .unwrap_or(true);
    if !enabled {
        return;
    }

    let base_url = std::env::var("BASE_URL").unwrap_or_else(|_| "http://localhost:3000".into());
    state
        .mailer
        .send_turn_reminder(email, game.id, &opponent.username, &base_url)
        .await;
}

#[cfg(test)]
mod tests {
    use super::*;

    const H: i64 = 60 * 60 * 1000;

    #[test]
    fn corr_reminder_fires_on_entry_into_the_window() {
        // First observation: fires.
        assert!(should_send_corr_reminder(12 * H, None));
        // Still declining inside the window: no re-fire.
        assert!(!should_send_corr_reminder(11 * H, Some(12 * H)));
        // Above the threshold: no fire.
        assert!(!should_send_corr_reminder(13 * H, Some(12 * H)));
    }

    #[test]
    fn corr_reminder_rearms_after_undo_restores_clock() {
        // Undo restored the clock above the threshold: re-entry fires again
        // on the same turn number.
        assert!(should_send_corr_reminder(12 * H, Some(20 * H)));
        // Exact re-crossing at the same value: no re-fire.
        assert!(!should_send_corr_reminder(12 * H, Some(12 * H)));
    }

    #[test]
    fn corr_reminder_restored_below_threshold_stays_quiet() {
        // Undo restored to 5h but the clock never left the window: no fire.
        assert!(!should_send_corr_reminder(5 * H, Some(12 * H)));
        // Clock refreshed to 24h (a move), then undo lands back in the
        // window: a fresh entry, fire.
        assert!(should_send_corr_reminder(5 * H, Some(24 * H)));
    }
}
