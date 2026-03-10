mod disconnect;
mod territory;
mod undo;

pub use disconnect::claim_victory;
pub use territory::{approve_territory, settle_territory, toggle_chain};
pub use undo::{request_undo, respond_to_undo};

use chrono::Utc;
use go_engine::{Engine, Stage, Stone};
use serde_json::json;

use crate::AppState;
use crate::error::AppError;
use crate::models::game::{Game, GameWithPlayers};
use crate::models::message::Message;
use crate::models::turn::{ClockSnapshot, TurnRow};
use crate::models::user::User;
use crate::services::clock::{self, ClockState, TimeControl};
use crate::services::{engine_builder, live, state_serializer};

// -- Return types --

pub struct ChatSent {
    pub message: Message,
}

// -- Core game actions --
// Each action performs business logic, persists state, and broadcasts to WS clients.
// Callers (API routes, WS handlers) only need to build their own response format.

pub async fn play_move(
    state: &AppState,
    game_id: i64,
    player_id: i64,
    col: i32,
    row: i32,
    client_move_time_ms: Option<i64>,
) -> Result<Engine, AppError> {
    if col < 0 || row < 0 {
        return Err(AppError::UnprocessableEntity(
            "Invalid coordinates".to_string(),
        ));
    }

    let mut gwp = load_game_and_check_player(state, game_id, player_id).await?;
    require_both_players(&gwp)?;
    require_not_challenge(&gwp)?;

    if gwp.game.result.is_some() {
        return Err(AppError::UnprocessableEntity(
            "The game is over".to_string(),
        ));
    }

    // Cannot play during territory review
    let engine = state
        .registry
        .get_or_init_engine(&state.db, &gwp.game)
        .await?;
    if engine.stage() == Stage::TerritoryReview {
        return Err(AppError::UnprocessableEntity(
            "Cannot play moves during territory review".to_string(),
        ));
    }

    let stone = player_stone(&gwp, player_id)?;

    let engine = apply_engine_mutation(state, game_id, &gwp.game, |engine| {
        engine.try_play(stone, (col as u8, row as u8)).map(|_| ())
    })
    .await?;

    // Capture clock state before processing the move
    let clock_snapshot = {
        let tc = TimeControl::from_game(&gwp.game);
        if !tc.is_none() {
            load_or_init_clock(state, game_id, &gwp.game)
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
    };

    // Persist all DB writes in a transaction
    let mut tx = state.db.begin().await?;

    let move_number = (engine.moves().len() - 1) as i32;
    if let Err(e) = TurnRow::create(
        &mut *tx,
        game_id,
        player_id,
        move_number,
        "play",
        stone.to_int() as i32,
        Some(col),
        Some(row),
        clock_snapshot.as_ref(),
    )
    .await
    {
        rollback_engine(state, game_id, &gwp.game).await;
        return Err(AppError::Internal(e.to_string()));
    }

    let first_move = gwp.game.started_at.is_none();
    if first_move {
        Game::set_started(&mut *tx, game_id).await?;
    }

    process_clock_after_move(
        state,
        &mut *tx,
        game_id,
        &gwp.game,
        ClockMoveParams {
            stone,
            first_move,
            player_id,
            client_move_time_ms,
        },
    )
    .await?;
    persist_stage(&mut *tx, game_id, &engine).await?;

    if gwp.game.undo_rejected {
        Game::set_undo_rejected(&mut *tx, game_id, false).await?;
        gwp.game.undo_rejected = false;
    }

    tx.commit().await?;

    // Non-transactional post-actions
    state.registry.set_undo_requested(game_id, false).await;
    broadcast_game_state(state, &gwp, &engine).await;

    Ok(engine)
}

pub async fn pass(
    state: &AppState,
    game_id: i64,
    player_id: i64,
    client_move_time_ms: Option<i64>,
) -> Result<Engine, AppError> {
    let mut gwp = load_game_and_check_player(state, game_id, player_id).await?;
    require_both_players(&gwp)?;
    require_not_challenge(&gwp)?;

    if gwp.game.result.is_some() {
        return Err(AppError::UnprocessableEntity(
            "The game is over".to_string(),
        ));
    }

    // Cannot pass during territory review
    let engine = state
        .registry
        .get_or_init_engine(&state.db, &gwp.game)
        .await?;
    if engine.stage() == Stage::TerritoryReview {
        return Err(AppError::UnprocessableEntity(
            "Cannot pass during territory review".to_string(),
        ));
    }

    let stone = player_stone(&gwp, player_id)?;

    let engine = apply_engine_mutation(state, game_id, &gwp.game, |engine| {
        engine.try_pass(stone).map(|_| ())
    })
    .await?;

    // Capture clock state before processing the move
    let clock_snapshot = {
        let tc = TimeControl::from_game(&gwp.game);
        if !tc.is_none() {
            load_or_init_clock(state, game_id, &gwp.game)
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
    };

    // Persist all DB writes in a transaction
    let mut tx = state.db.begin().await?;

    let move_number = (engine.moves().len() - 1) as i32;
    if let Err(e) = TurnRow::create(
        &mut *tx,
        game_id,
        player_id,
        move_number,
        "pass",
        stone.to_int() as i32,
        None,
        None,
        clock_snapshot.as_ref(),
    )
    .await
    {
        rollback_engine(state, game_id, &gwp.game).await;
        return Err(AppError::Internal(e.to_string()));
    }

    process_clock_after_move(
        state,
        &mut *tx,
        game_id,
        &gwp.game,
        ClockMoveParams {
            stone,
            first_move: false,
            player_id,
            client_move_time_ms,
        },
    )
    .await?;
    persist_stage(&mut *tx, game_id, &engine).await?;

    if gwp.game.undo_rejected {
        Game::set_undo_rejected(&mut *tx, game_id, false).await?;
        gwp.game.undo_rejected = false;
    }

    // Pause clock if entering territory review
    if engine.stage() == Stage::TerritoryReview {
        pause_clock(state, &mut *tx, game_id, &gwp.game).await?;
    }

    tx.commit().await?;

    // Non-transactional post-actions
    state.registry.set_undo_requested(game_id, false).await;

    if engine.stage() == Stage::TerritoryReview {
        let dead_stones = go_engine::territory::detect_dead_stones(engine.goban());
        state
            .registry
            .init_territory_review(game_id, dead_stones)
            .await;
        broadcast_system_chat(
            state,
            game_id,
            "Territory review has begun",
            Some(engine.moves().len() as i32),
        )
        .await;
    }

    broadcast_game_state(state, &gwp, &engine).await;

    Ok(engine)
}

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

        if let Some(result) = engine.result() {
            Game::set_ended(&mut *tx, game_id, result, "completed").await?;
        }

        tx.commit().await?;

        gwp.game.result = engine.result().map(String::from);
        gwp.game.stage = "completed".to_string();
    }

    broadcast_game_state(state, &gwp, &engine).await;

    Ok(engine)
}

pub async fn accept_challenge(
    state: &AppState,
    game_id: i64,
    player_id: i64,
) -> Result<(), AppError> {
    let gwp = load_game_and_check_player(state, game_id, player_id).await?;

    if gwp.game.result.is_some() {
        return Err(AppError::UnprocessableEntity(
            "The game is over".to_string(),
        ));
    }
    if gwp.game.stage != "challenge" {
        return Err(AppError::UnprocessableEntity(
            "Game is not in challenge state".to_string(),
        ));
    }
    if gwp.game.creator_id == Some(player_id) {
        return Err(AppError::UnprocessableEntity(
            "Only the challenged player can accept".to_string(),
        ));
    }

    // Nigiri: randomize colors now that the game is starting
    let nigiri_swapped = if gwp.game.nigiri {
        use rand::RngExt;
        if rand::rng().random_bool(0.5) {
            Game::swap_players(&state.db, game_id).await?;
            true
        } else {
            false
        }
    } else {
        false
    };

    let start_stage = if gwp.game.handicap >= 2 {
        "white_to_play"
    } else {
        "black_to_play"
    };
    Game::set_stage(&state.db, game_id, start_stage).await?;

    // Only reload if nigiri swapped (need updated black/white IDs); otherwise update in-place
    let gwp = if nigiri_swapped {
        Game::find_with_players(&state.db, game_id).await?
    } else {
        let mut gwp = gwp;
        gwp.game.stage = start_stage.to_string();
        gwp
    };
    let engine = state
        .registry
        .get_or_init_engine(&state.db, &gwp.game)
        .await?;

    broadcast_game_state(state, &gwp, &engine).await;
    live::notify_game_updated(state, &gwp, None, &gwp.game.stage);

    Ok(())
}

pub async fn decline_challenge(
    state: &AppState,
    game_id: i64,
    player_id: i64,
) -> Result<(), AppError> {
    let gwp = load_game_and_check_player(state, game_id, player_id).await?;

    if gwp.game.result.is_some() {
        return Err(AppError::UnprocessableEntity(
            "The game is over".to_string(),
        ));
    }
    if gwp.game.stage != "challenge" {
        return Err(AppError::UnprocessableEntity(
            "Game is not in challenge state".to_string(),
        ));
    }
    if gwp.game.creator_id == Some(player_id) {
        return Err(AppError::UnprocessableEntity(
            "Only the challenged player can decline".to_string(),
        ));
    }

    Game::set_ended(&state.db, game_id, "Declined", "declined").await?;

    live::notify_game_removed(state, game_id);

    // Broadcast updated state to anyone watching
    let mut gwp = gwp;
    gwp.game.result = Some("Declined".to_string());
    gwp.game.stage = "declined".to_string();
    if let Ok(engine) = state
        .registry
        .get_or_init_engine(&state.db, &gwp.game)
        .await
    {
        broadcast_game_state(state, &gwp, &engine).await;
    }

    Ok(())
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

pub async fn send_chat(
    state: &AppState,
    game_id: i64,
    player_id: i64,
    text: &str,
) -> Result<ChatSent, AppError> {
    let text = text.trim();
    if text.is_empty() {
        return Err(AppError::UnprocessableEntity(
            "Message cannot be empty".to_string(),
        ));
    }
    if text.len() > 1000 {
        return Err(AppError::UnprocessableEntity(
            "Message too long (max 1000 characters)".to_string(),
        ));
    }

    let gwp = Game::find_with_players(&state.db, game_id).await?;

    // Private game chat requires being a player
    if gwp.game.is_private && !gwp.has_player(player_id) {
        return Err(AppError::UnprocessableEntity(
            "Cannot chat in a private game you're not part of".to_string(),
        ));
    }

    let user = User::find_by_id(&state.db, player_id).await?;

    let move_number = current_move_number(state, &gwp.game).await;

    let msg = Message::create(&state.db, game_id, Some(player_id), text, move_number).await?;

    state
        .registry
        .broadcast(
            game_id,
            &json!({
                "kind": "chat",
                "game_id": game_id,
                "player_id": player_id,
                "display_name": user.display_name(),
                "text": msg.text,
                "move_number": msg.move_number,
                "sent_at": msg.created_at
            })
            .to_string(),
        )
        .await;

    Ok(ChatSent { message: msg })
}

// -- Timeout handlers --

/// Handle a client-initiated timeout flag. Validates the clock truly expired before ending the game.
pub async fn handle_timeout_flag(
    state: &AppState,
    game_id: i64,
    _player_id: i64,
) -> Result<(), AppError> {
    let now = Utc::now();

    let gwp = Game::find_with_players(&state.db, game_id).await?;

    if gwp.game.result.is_some() {
        return Ok(());
    }

    let tc = TimeControl::from_game(&gwp.game);
    if tc.is_none() {
        return Ok(());
    }

    let clock = load_or_init_clock(state, game_id, &gwp.game).await?;

    let Some(active) = clock::active_stone_from_stage(&gwp.game.stage) else {
        return Ok(());
    };

    // Apply flag grace from lag compensation before flagging
    let active_player_id = match active {
        Stone::Black => gwp.game.black_id,
        Stone::White => gwp.game.white_id,
    };
    let grace_ms = match active_player_id {
        Some(pid) => state.registry.flag_grace_ms(game_id, pid).await,
        None => 0,
    };
    let check_now = now - chrono::TimeDelta::milliseconds(grace_ms);

    if !clock.is_flagged(active, Some(active), &tc, check_now) {
        return Ok(());
    }

    end_game_on_time(state, gwp, active, clock, &tc, now).await
}

/// Handle a client-initiated territory review timeout flag.
/// Validates the deadline truly expired before settling the game.
pub async fn handle_territory_timeout_flag(
    state: &AppState,
    game_id: i64,
    _player_id: i64,
) -> Result<(), AppError> {
    let gwp = Game::find_with_players(&state.db, game_id).await?;

    if gwp.game.result.is_some() {
        return Ok(());
    }

    let deadline = match gwp.game.territory_review_expires_at {
        Some(d) => d,
        None => return Ok(()),
    };

    if Utc::now() < deadline {
        return Ok(());
    }

    let engine = state
        .registry
        .get_or_init_engine(&state.db, &gwp.game)
        .await?;

    if engine.stage() != Stage::TerritoryReview {
        return Ok(());
    }

    let tr = state
        .registry
        .get_territory_review(game_id)
        .await
        .ok_or_else(|| AppError::Internal("Territory review state not found".to_string()))?;

    settle_territory(state, game_id, gwp, &engine, &tr.dead_stones).await
}

/// End a game due to time expiration. Used by both client flag and server sweep.
pub async fn end_game_on_time(
    state: &AppState,
    mut gwp: GameWithPlayers,
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
    Game::set_ended(&mut *tx, game_id, result, "completed").await?;
    persist_clock(state, &mut *tx, game_id, &clock, tc, None).await?;
    tx.commit().await?;

    // Non-transactional post-actions
    let _ = state
        .registry
        .with_engine_mut(game_id, |engine| {
            engine.set_result(result.to_string());
            Ok(())
        })
        .await;

    gwp.game.result = Some(result.to_string());
    gwp.game.stage = "completed".to_string();

    let engine = state.registry.get_engine(game_id).await;
    let move_number = engine.as_ref().map(|e| e.moves().len() as i32);
    broadcast_system_chat(state, game_id, &format!("Game over. {result}"), move_number).await;

    if let Some(engine) = engine {
        broadcast_game_state(state, &gwp, &engine).await;
    }

    live::notify_game_removed(state, game_id);

    Ok(())
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

    let game_state = state_serializer::serialize_state(
        gwp,
        engine,
        undo_requested,
        territory.as_ref(),
        None,
        clock_ref,
    );

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
    let sent_at = saved.as_ref().map(|m| m.created_at);

    state
        .registry
        .broadcast(
            game_id,
            &json!({
                "kind": "chat",
                "game_id": game_id,
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

async fn apply_engine_mutation<F>(
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
    executor: impl sqlx::PgExecutor<'_>,
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

async fn current_move_number(state: &AppState, game: &Game) -> Option<i32> {
    state
        .registry
        .get_or_init_engine(&state.db, game)
        .await
        .ok()
        .map(|e| e.moves().len() as i32)
}

// -- Clock helpers --

struct ClockMoveParams {
    stone: Stone,
    first_move: bool,
    player_id: i64,
    client_move_time_ms: Option<i64>,
}

/// Process clock after a play or pass move.
async fn process_clock_after_move(
    state: &AppState,
    executor: impl sqlx::PgExecutor<'_>,
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
    executor: impl sqlx::PgExecutor<'_>,
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
async fn load_or_init_clock(
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
    executor: impl sqlx::PgExecutor<'_>,
    game_id: i64,
    clock: &ClockState,
    tc: &TimeControl,
    active_stone: Option<Stone>,
) -> Result<(), AppError> {
    Game::update_clock(executor, game_id, &clock.to_update(active_stone, tc)).await?;

    state.registry.update_clock(game_id, clock.clone()).await;

    Ok(())
}
