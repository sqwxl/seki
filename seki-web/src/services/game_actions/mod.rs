mod challenges;
mod chat;
mod disconnect;
mod play;
mod resign;
mod territory;
mod undo;

pub use challenges::{accept_challenge, decline_challenge};
pub use chat::{end_game_on_time, handle_territory_timeout_flag, handle_timeout_flag, send_chat};
pub use disconnect::claim_victory;
pub use play::{pass, play_move};
pub use resign::{abort, resign};
pub use territory::{approve_territory, settle_territory, toggle_chain};
pub use undo::{request_undo, respond_to_undo};

use chrono::Utc;
use go_engine::{Engine, Stage, Stone};
use serde_json::json;

use crate::AppState;
use crate::error::AppError;
use crate::models::game::{Game, GameWithPlayers};
use crate::models::message::Message;
use crate::services::clock::{self, ClockState, TimeControl};
use crate::services::{engine_builder, live, state_serializer};

pub struct ChatSent {
    pub message: Message,
}

// -- Internal helpers --

pub(super) async fn broadcast_game_state(state: &AppState, gwp: &GameWithPlayers, engine: &Engine) {
    let game_id = gwp.game.id;
    let undo_requested = state.registry.is_undo_requested(game_id).await;

    let territory = if engine.stage() == Stage::TerritoryReview {
        state
            .registry
            .get_territory_review(game_id)
            .await
            .map(|tr| {
                state_serializer::compute_territory_data(
                    engine,
                    &tr.dead_stones,
                    gwp.game.komi,
                    tr.black_approved,
                    tr.white_approved,
                    gwp.game.territory_review_expires_at,
                )
            })
    } else {
        None
    };

    let tc = TimeControl::from_game(&gwp.game);
    let clock_data = if !tc.is_none() {
        state.registry.get_clock(game_id).await.map(|c| (c, tc))
    } else {
        None
    };
    let clock_ref = clock_data.as_ref().map(|(c, tc)| (c, tc));

    let mut game_state = state_serializer::serialize_state(
        gwp,
        engine,
        undo_requested,
        territory.as_ref(),
        None,
        clock_ref,
    );

    if let Some(ref black) = gwp.black
        && let Ok(profile) = crate::models::rating::RatingProfile::find(&state.db, black.id).await
    {
        let user_data = crate::templates::UserData::from_user_with_rank(black, profile.as_ref());
        game_state["black"] = serde_json::to_value(&user_data).unwrap_or_default();
    }
    if let Some(ref white) = gwp.white
        && let Ok(profile) = crate::models::rating::RatingProfile::find(&state.db, white.id).await
    {
        let user_data = crate::templates::UserData::from_user_with_rank(white, profile.as_ref());
        game_state["white"] = serde_json::to_value(&user_data).unwrap_or_default();
    }

    state
        .registry
        .broadcast(game_id, &game_state.to_string())
        .await;

    // Notify live subscribers (games list, etc.)
    // Use engine stage, not gwp.game.stage, which may be stale (loaded before mutation).
    let stage = engine.stage().to_string();
    live::notify_game_updated(state, gwp, Some(engine.moves().len()), &stage);
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

/// Load clock from registry cache, falling back to the game row.
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
