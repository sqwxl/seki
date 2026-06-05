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

    let mut engine = match state
        .registry
        .get_or_init_engine(&state.db, &gwp.game)
        .await
    {
        Ok(engine) => engine,
        Err(e) => {
            tracing::error!(game_id, error = %e, "Failed to load engine after game end");
            return;
        }
    };

    engine.set_result(result.to_string());
    state.registry.replace_engine(game_id, engine.clone()).await;

    gwp.game.result = Some(result.to_string());
    gwp.game.stage = "completed".to_string();

    let move_number = Some(engine.moves().len() as i32);

    for chat in extra_system_chats {
        broadcast_system_chat(state, game_id, chat, move_number).await;
    }
    broadcast_system_chat(state, game_id, &format!("Game over. {result}"), move_number).await;
    broadcast_game_state(state, gwp, &engine).await;
}

#[cfg(test)]
mod tests {
    use chrono::{Duration, Utc};
    use go_engine::Stone;

    use super::end_game_on_time;
    use crate::models::game::{Game, TimeControlType};
    use crate::models::user::User;
    use crate::services::clock::{ClockState, TimeControl};

    async fn test_pool() -> crate::db::DbPool {
        let path = std::env::temp_dir().join(format!(
            "seki-end-game-test-{}-{}.db",
            std::process::id(),
            Utc::now().timestamp_nanos_opt().unwrap()
        ));
        let url = format!("sqlite://{}", path.display());
        let pool = crate::db::create_pool(&url).await.unwrap();
        crate::db::run_migrations(&pool).await.unwrap();
        pool
    }

    #[tokio::test]
    async fn timeout_end_hydrates_uncached_engine() {
        let pool = test_pool().await;
        let black = User::create(&pool).await.unwrap();
        let white = User::create(&pool).await.unwrap();

        let game = Game::create(
            &pool,
            black.id,
            Some(white.id),
            Some(black.id),
            Some(white.id),
            9,
            9,
            6.5,
            0,
            false,
            false,
            "access-token",
            None,
            TimeControlType::Fischer,
            Some(1),
            Some(0),
            None,
            None,
            Some(0),
            Some(1_000),
            Some(0),
            Some(0),
            false,
            None,
            false,
            false,
            "unlimited",
            None,
            None,
            true,
            true,
        )
        .await
        .unwrap();

        sqlx::query("UPDATE games SET stage = 'black_turn' WHERE id = $1")
            .bind(game.id)
            .execute(&pool)
            .await
            .unwrap();

        let (_router, state) = crate::build_router(pool.clone(), false).await;
        assert!(state.registry.get_engine(game.id).await.is_none());

        let gwp = Game::find_with_players(&pool, game.id).await.unwrap();
        let tc = TimeControl::from_game(&gwp.game);
        let mut clock = ClockState::from_game(&gwp.game).unwrap();
        let now = Utc::now();
        clock.last_move_at = Some(now - Duration::seconds(2));

        end_game_on_time(&state, gwp, Stone::Black, clock, &tc, now)
            .await
            .unwrap();

        let ended = Game::find_by_id(&pool, game.id).await.unwrap();
        assert_eq!(ended.result.as_deref(), Some("W+T"));
        assert_eq!(ended.stage, "completed");

        let engine = state.registry.get_engine(game.id).await.unwrap();
        assert_eq!(engine.result(), Some("W+T"));
    }
}
