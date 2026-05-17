use chrono::Utc;
use go_engine::{Stage, Stone};
use serde_json::json;

use crate::AppState;
use crate::error::AppError;
use crate::models::game::{Game, GameWithPlayers};
use crate::models::message::Message;
use crate::models::user::User;
use crate::services::clock::{self, ClockState, TimeControl};
use crate::services::live;

use super::{
    ChatSent, broadcast_game_state, broadcast_system_chat, current_move_number, load_or_init_clock,
    persist_clock, settle_territory,
};

pub async fn send_chat(
    state: &AppState,
    game_id: i64,
    player_id: i64,
    text: &str,
    client_message_id: Option<&str>,
) -> Result<ChatSent, AppError> {
    let text = text.trim();
    if text.is_empty() {
        return Err(AppError::UnprocessableEntity(
            "Message cannot be empty".to_string(),
        ));
    }
    if text.len() > 160 {
        return Err(AppError::UnprocessableEntity(
            "Message too long (max 160 characters)".to_string(),
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

    let msg = Message::create(
        &state.db,
        game_id,
        Some(player_id),
        client_message_id,
        text,
        move_number,
    )
    .await?;

    state
        .registry
        .broadcast(
            game_id,
            &json!({
                "kind": "chat",
                "game_id": game_id,
                "id": msg.id,
                "player_id": player_id,
                "display_name": user.display_name(),
                "client_message_id": client_message_id,
                "text": msg.text,
                "move_number": msg.move_number,
                "sent_at": msg.created_at
            })
            .to_string(),
        )
        .await;

    Ok(ChatSent { message: msg })
}

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
    let ended = Game::set_ended(&mut *tx, game_id, result, "completed").await?;
    persist_clock(state, &mut *tx, game_id, &clock, tc, None).await?;
    tx.commit().await?;

    if !ended {
        // Another caller already ended this game — skip duplicate broadcasts.
        return Ok(());
    }

    // Rating finalization (outside transaction to avoid locks)
    if let Some(b_id) = gwp.game.black_id
        && let Some(w_id) = gwp.game.white_id
        && let Err(e) =
            crate::services::rating::finalize_rating(&state.db, &gwp.game, result, b_id, w_id).await
    {
        tracing::error!(
            game_id,
            error = %e,
            "Failed to finalize rating after timeout"
        );
    }

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
