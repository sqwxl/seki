mod challenges;
mod chat;
mod disconnect;
mod end_game;
mod play;
mod pregame_settings;
mod rematch;
mod resign;
mod territory;
mod undo;

pub use challenges::{accept_challenge, decline_challenge};
pub use chat::{handle_territory_timeout_flag, handle_timeout_flag, send_chat};
pub use disconnect::claim_victory;
pub use end_game::end_game_on_time;
pub use play::{pass, play_move};
pub use pregame_settings::{
    accept_pregame_settings, reject_pregame_settings, update_pregame_settings,
};
pub use rematch::rematch_game;
pub use resign::{abort, resign};
pub use territory::{approve_territory, settle_territory, toggle_chain};
pub use undo::{request_undo, respond_to_undo};

use chrono::Utc;
use go_engine::{Engine, Stone};
use serde_json::json;

use crate::AppState;
use crate::error::AppError;
use crate::models::game::{Game, GameWithPlayers};
use crate::models::message::Message;
use crate::models::turn::ClockSnapshot;
use crate::services::clock::{self, ClockState, TimeControl};
use crate::services::{engine_builder, live, state_assembly};

pub struct ChatSent {
    pub message: Message,
}

// -- Internal helpers --

pub(super) async fn broadcast_game_state(state: &AppState, gwp: &GameWithPlayers, engine: &Engine) {
    let game_id = gwp.game.id;
    let undo_requested = state.registry.is_undo_requested(game_id).await;

    let Ok(loaded) =
        state_assembly::load_game_state(state, gwp, engine, game_id, undo_requested).await
    else {
        tracing::error!(game_id, "Failed to load game state for broadcast");
        return;
    };

    state
        .registry
        .broadcast(game_id, &loaded.value.to_string())
        .await;

    // Notify live subscribers (games list, etc.)
    // Use engine stage, not gwp.game.stage, which may be stale (loaded before mutation).
    let stage = engine.stage().to_string();
    let board_state = serde_json::to_value(engine.game_state()).ok();
    let clock = if gwp.game.time_control == crate::models::game::TimeControlType::None {
        None
    } else {
        Some(live::ClockSnapshot {
            black_ms: gwp.game.clock_black_ms,
            white_ms: gwp.game.clock_white_ms,
            black_periods: gwp.game.clock_black_periods,
            white_periods: gwp.game.clock_white_periods,
            active_stone: gwp.game.clock_active_stone,
        })
    };
    live::notify_game_updated(
        state,
        gwp,
        Some(engine.moves().len()),
        &stage,
        board_state,
        clock,
    );

    // Keep the DB cache fresh so lobby init / game_created messages
    // include the latest board state (including last_move marker).
    let _ = engine_builder::cache_engine_state(
        &state.db,
        game_id,
        engine,
        engine.moves().len() as i64,
        None,
    )
    .await;
}

pub(super) async fn broadcast_system_chat(
    state: &AppState,
    game_id: i64,
    text: &str,
    move_number: Option<i32>,
) {
    let saved = Message::create_system(&state.db, game_id, text, move_number)
        .await
        .ok();
    let id = saved.as_ref().map(|m| m.id);
    let sent_at = saved.as_ref().map(|m| m.created_at);

    state
        .registry
        .broadcast(
            game_id,
            &json!({
                "kind": "chat",
                "game_id": game_id,
                "id": id,
                "text": text,
                "move_number": move_number,
                "sent_at": sent_at
            })
            .to_string(),
        )
        .await;
}

pub(super) async fn load_game_and_check_player(
    state: &AppState,
    game_id: i64,
    player_id: i64,
) -> Result<GameWithPlayers, AppError> {
    let gwp = Game::find_with_players(&state.db, game_id).await?;

    if !gwp.has_player(player_id) {
        return Err(AppError::UnprocessableEntity(
            "Only players can perform this action".to_string(),
        ));
    }

    Ok(gwp)
}

pub(super) fn require_both_players(gwp: &GameWithPlayers) -> Result<(), AppError> {
    if gwp.is_open() {
        return Err(AppError::UnprocessableEntity(
            "Waiting for opponent to join".to_string(),
        ));
    }
    Ok(())
}

pub(super) fn require_not_challenge(gwp: &GameWithPlayers) -> Result<(), AppError> {
    if gwp.game.stage == "challenge" {
        return Err(AppError::UnprocessableEntity(
            "Challenge must be accepted before playing".to_string(),
        ));
    }
    Ok(())
}

pub(super) fn player_stone(gwp: &GameWithPlayers, player_id: i64) -> Result<Stone, AppError> {
    Stone::from_int(gwp.player_stone(player_id) as i8)
        .ok_or_else(|| AppError::UnprocessableEntity("You are not a user in this game".to_string()))
}

pub(super) async fn apply_engine_mutation<F>(
    state: &AppState,
    game_id: i64,
    game: &Game,
    f: F,
) -> Result<Engine, AppError>
where
    F: FnOnce(&mut Engine) -> Result<(), go_engine::GoError>,
{
    state.registry.get_or_init_engine(&state.db, game).await?;

    match state.registry.with_engine_mut(game_id, f).await {
        Some(Ok(engine)) => Ok(engine),
        Some(Err(e)) => Err(AppError::UnprocessableEntity(e.to_string())),
        None => Err(AppError::Internal("Engine cache unavailable".to_string())),
    }
}

pub(super) async fn persist_stage(
    executor: impl sqlx::SqliteExecutor<'_>,
    game_id: i64,
    engine: &Engine,
) -> Result<(), AppError> {
    Game::set_stage(executor, game_id, &engine.stage().to_string()).await?;
    Ok(())
}

pub(super) async fn rollback_engine(state: &AppState, game_id: i64, game: &Game) {
    if let Ok(rebuilt) = engine_builder::build_engine(&state.db, game).await {
        state.registry.replace_engine(game_id, rebuilt).await;
    }
}

pub(super) async fn current_move_number(state: &AppState, game: &Game) -> Option<i32> {
    state
        .registry
        .get_or_init_engine(&state.db, game)
        .await
        .ok()
        .map(|e| e.moves().len() as i32)
}

// -- Clock helpers --

pub(super) struct ClockMoveParams {
    pub(super) stone: Stone,
    pub(super) first_move: bool,
    pub(super) player_id: i64,
    pub(super) client_move_time_ms: Option<i64>,
}

/// Process clock after a play or pass move.
pub(super) async fn process_clock_after_move(
    state: &AppState,
    executor: impl sqlx::SqliteExecutor<'_>,
    game_id: i64,
    game: &Game,
    params: ClockMoveParams,
) -> Result<(), AppError> {
    let tc = TimeControl::from_game(game);
    if tc.is_none() {
        return Ok(());
    }

    let mut clock = load_or_init_clock(state, game_id, game).await?;
    let now = Utc::now();
    let active = clock::active_stone_from_stage(&game.stage);

    if params.first_move {
        clock.start(now);
    } else {
        // Compute lag compensation before processing the move
        let comp_ms = if let Some(last) = clock.last_move_at
            && active == Some(params.stone)
        {
            let server_elapsed_ms = (now - last).num_milliseconds().max(0);
            state
                .registry
                .record_lag(
                    game_id,
                    params.player_id,
                    &tc,
                    server_elapsed_ms,
                    params.client_move_time_ms,
                )
                .await
        } else {
            0
        };

        // Adjust the effective "now" by crediting back the compensated lag
        let effective_now = if comp_ms > 0 {
            now - chrono::TimeDelta::milliseconds(comp_ms)
        } else {
            now
        };
        clock.process_move(params.stone, active, &tc, effective_now);
    }

    // After the move, the new active stone is always the opponent
    let new_active = Some(params.stone.opp());
    persist_clock(state, executor, game_id, &clock, &tc, new_active).await?;

    Ok(())
}

/// Pause the clock (territory review, game end).
pub(super) async fn pause_clock(
    state: &AppState,
    executor: impl sqlx::SqliteExecutor<'_>,
    game_id: i64,
    game: &Game,
) -> Result<(), AppError> {
    let tc = TimeControl::from_game(game);
    if tc.is_none() {
        return Ok(());
    }

    if let Some(mut clock) = state.registry.get_clock(game_id).await {
        let active = clock::active_stone_from_stage(&game.stage);
        clock.pause(active, Utc::now());
        persist_clock(state, executor, game_id, &clock, &tc, None).await?;
    }

    Ok(())
}

/// Capture a clock snapshot before persisting a move or pass.
pub(super) async fn capture_clock_snapshot(
    state: &AppState,
    game_id: i64,
    game: &Game,
) -> Option<ClockSnapshot> {
    let tc = TimeControl::from_game(game);
    if !tc.is_none() {
        load_or_init_clock(state, game_id, game)
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
}

pub(super) async fn load_or_init_clock(
    state: &AppState,
    game_id: i64,
    game: &Game,
) -> Result<ClockState, AppError> {
    if let Some(clock) = state.registry.get_clock(game_id).await {
        return Ok(clock);
    }

    let clock = ClockState::from_game(game)
        .ok_or_else(|| AppError::Internal("Clock not found for timed game".to_string()))?;

    state.registry.update_clock(game_id, clock.clone()).await;
    Ok(clock)
}

/// Persist clock state to both DB and registry cache (games table).
/// `active_stone` is the user whose clock should be ticking (None if paused).
/// DB is written first so a failure doesn't leave the in-memory cache ahead of DB.
pub(super) async fn persist_clock(
    state: &AppState,
    executor: impl sqlx::SqliteExecutor<'_>,
    game_id: i64,
    clock: &ClockState,
    tc: &TimeControl,
    active_stone: Option<Stone>,
) -> Result<(), AppError> {
    Game::update_clock(executor, game_id, &clock.to_update(active_stone, tc)).await?;

    state.registry.update_clock(game_id, clock.clone()).await;

    Ok(())
}
