use go_engine::{Engine, Stage, Stone};
use serde_json::json;

use crate::error::AppError;
use crate::models::game::{Game, GameWithPlayers, SYSTEM_SYMBOL};
use crate::models::message::Message;
use crate::models::player::Player;
use crate::models::turn::TurnRow;
use crate::services::{engine_builder, state_serializer};
use crate::AppState;

// -- Return types --

pub struct ChatSent {
    pub message: Message,
    pub sender_label: String,
}

pub struct UndoResult {
    pub accepted: bool,
    pub engine: Engine,
    pub gwp: GameWithPlayers,
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
) -> Result<Engine, AppError> {
    if col < 0 || row < 0 {
        return Err(AppError::BadRequest("Invalid coordinates".to_string()));
    }

    let gwp = load_game_and_check_player(state, game_id, player_id).await?;
    require_both_players(&gwp)?;
    let stone = player_stone(&gwp, player_id)?;

    let engine = apply_engine_mutation(state, game_id, &gwp.game, |engine| {
        engine.try_play(stone, (col as u8, row as u8)).map(|_| ())
    })
    .await?;

    // Persist the turn
    let turn_count = TurnRow::count_by_game_id(&state.db, game_id)
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;
    if let Err(e) = TurnRow::create(
        &state.db,
        game_id,
        player_id,
        turn_count as i32,
        "play",
        stone.to_int() as i32,
        Some(col),
        Some(row),
    )
    .await
    {
        rollback_engine(state, game_id, &gwp.game).await;
        return Err(AppError::Internal(e.to_string()));
    }

    // Mark game as started on first move
    if gwp.game.started_at.is_none() {
        Game::set_started(&state.db, game_id)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;
    }

    // Update stage
    persist_stage(state, game_id, &engine).await?;

    // Clear pending undo request and rejection flag
    state.registry.set_undo_requested(game_id, false).await;
    if gwp.game.undo_rejected {
        Game::set_undo_rejected(&state.db, game_id, false)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;
    }

    broadcast_game_state(state, game_id, &engine).await;

    Ok(engine)
}

pub async fn pass(state: &AppState, game_id: i64, player_id: i64) -> Result<Engine, AppError> {
    let gwp = load_game_and_check_player(state, game_id, player_id).await?;
    require_both_players(&gwp)?;
    let stone = player_stone(&gwp, player_id)?;

    let engine = apply_engine_mutation(state, game_id, &gwp.game, |engine| {
        engine.try_pass(stone).map(|_| ())
    })
    .await?;

    // Persist the turn
    let turn_count = TurnRow::count_by_game_id(&state.db, game_id)
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;
    if let Err(e) = TurnRow::create(
        &state.db,
        game_id,
        player_id,
        turn_count as i32,
        "pass",
        stone.to_int() as i32,
        None,
        None,
    )
    .await
    {
        rollback_engine(state, game_id, &gwp.game).await;
        return Err(AppError::Internal(e.to_string()));
    }

    // Update stage
    persist_stage(state, game_id, &engine).await?;

    // Clear pending undo request and rejection flag
    state.registry.set_undo_requested(game_id, false).await;
    if gwp.game.undo_rejected {
        Game::set_undo_rejected(&state.db, game_id, false)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;
    }

    broadcast_game_state(state, game_id, &engine).await;

    Ok(engine)
}

pub async fn resign(state: &AppState, game_id: i64, player_id: i64) -> Result<Engine, AppError> {
    let gwp = load_game_and_check_player(state, game_id, player_id).await?;
    require_both_players(&gwp)?;

    if gwp.game.result.is_some() {
        return Err(AppError::BadRequest("The game is over".to_string()));
    }

    let stone = player_stone(&gwp, player_id)?;

    let engine = apply_engine_mutation(state, game_id, &gwp.game, |engine| {
        engine.try_resign(stone);
        Ok(())
    })
    .await?;

    let stage = engine.stage();
    if stage == Stage::Done {
        if let Some(result) = engine.result() {
            if let Err(e) = Game::set_ended(&state.db, game_id, result).await {
                rollback_engine(state, game_id, &gwp.game).await;
                return Err(AppError::Internal(e.to_string()));
            }
        }

        let turn_count = TurnRow::count_by_game_id(&state.db, game_id)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;
        if let Err(e) = TurnRow::create(
            &state.db,
            game_id,
            player_id,
            turn_count as i32,
            "resign",
            stone.to_int() as i32,
            None,
            None,
        )
        .await
        {
            rollback_engine(state, game_id, &gwp.game).await;
            return Err(AppError::Internal(e.to_string()));
        }
    }

    broadcast_game_state(state, game_id, &engine).await;

    Ok(engine)
}

pub async fn send_chat(
    state: &AppState,
    game_id: i64,
    player_id: i64,
    text: &str,
) -> Result<ChatSent, AppError> {
    let text = text.trim();
    if text.is_empty() {
        return Err(AppError::BadRequest("Message cannot be empty".to_string()));
    }
    if text.len() > 1000 {
        return Err(AppError::BadRequest(
            "Message too long (max 1000 characters)".to_string(),
        ));
    }

    let gwp = Game::find_with_players(&state.db, game_id)
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;

    if !gwp.has_player(player_id) {
        return Err(AppError::BadRequest(
            "Only players can send messages".to_string(),
        ));
    }

    let move_number = current_move_number(state, &gwp.game).await;

    let msg = Message::create(&state.db, game_id, Some(player_id), text, move_number)
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;

    let player = Player::find_by_id(&state.db, player_id)
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;

    let sender = state_serializer::sender_label(&gwp, player_id, Some(&player.username));

    state
        .registry
        .broadcast(
            game_id,
            &json!({
                "kind": "chat",
                "sender": sender,
                "text": msg.text,
                "move_number": msg.move_number,
                "sent_at": msg.created_at
            })
            .to_string(),
        )
        .await;

    Ok(ChatSent {
        message: msg,
        sender_label: sender,
    })
}

pub async fn request_undo(
    state: &AppState,
    game_id: i64,
    player_id: i64,
) -> Result<(), AppError> {
    let gwp = load_game_and_check_player(state, game_id, player_id).await?;

    if !gwp.game.allow_undo {
        return Err(AppError::BadRequest(
            "Takebacks are not allowed in this game".into(),
        ));
    }

    if state.registry.is_undo_requested(game_id).await {
        return Err(AppError::BadRequest(
            "An undo request is already pending".to_string(),
        ));
    }

    if gwp.game.undo_rejected {
        return Err(AppError::BadRequest(
            "Undo was already rejected for the current move".to_string(),
        ));
    }

    let last_turn = TurnRow::last_turn(&state.db, game_id)
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;
    let last_turn =
        last_turn.ok_or_else(|| AppError::BadRequest("No turns to undo".to_string()))?;
    if last_turn.player_id != player_id {
        return Err(AppError::BadRequest(
            "Can only undo your own turn".to_string(),
        ));
    }
    if last_turn.kind != "play" {
        return Err(AppError::BadRequest("Can only undo play turns".to_string()));
    }

    state.registry.set_undo_requested(game_id, true).await;

    let player = Player::find_by_id(&state.db, player_id)
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;
    let requesting_name = player.display_name().to_string();
    let opponent = gwp.opponent_of(player_id).cloned();

    // System chat
    broadcast_system_chat(
        state,
        game_id,
        &format!("{requesting_name} requested to undo their last move"),
    )
    .await;

    // Notify requester: disable undo button
    state
        .registry
        .send_to_player(
            game_id,
            player_id,
            &json!({ "kind": "undo_request_sent" }).to_string(),
        )
        .await;

    // Notify opponent: show accept/reject controls
    if let Some(opponent) = &opponent {
        state
            .registry
            .send_to_player(
                game_id,
                opponent.id,
                &json!({
                    "kind": "undo_response_needed",
                    "requesting_player": requesting_name,
                })
                .to_string(),
            )
            .await;
    }

    Ok(())
}

pub async fn respond_to_undo(
    state: &AppState,
    game_id: i64,
    player_id: i64,
    accept: bool,
) -> Result<UndoResult, AppError> {
    let gwp = load_game_and_check_player(state, game_id, player_id).await?;

    if !state.registry.is_undo_requested(game_id).await {
        return Err(AppError::BadRequest("No pending undo request".to_string()));
    }

    // The requesting player is the one who played last (out of turn now)
    let engine = state
        .registry
        .get_or_init_engine(&state.db, &gwp.game)
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;
    let requesting_player_id = gwp
        .out_of_turn_player(engine.current_turn_stone())
        .map(|p| p.id)
        .ok_or_else(|| AppError::Internal("Cannot determine requesting player".to_string()))?;

    if requesting_player_id == player_id {
        return Err(AppError::BadRequest(
            "Cannot respond to your own undo request".to_string(),
        ));
    }

    let responding_player = Player::find_by_id(&state.db, player_id)
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;
    let responding_name = responding_player.display_name().to_string();

    // Clear the in-memory request flag regardless of accept/reject
    state.registry.set_undo_requested(game_id, false).await;

    let result = if accept {
        TurnRow::delete_last(&state.db, game_id)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;

        let game = Game::find_by_id(&state.db, game_id)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;
        let engine = engine_builder::build_engine(&state.db, &game)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;
        state.registry.replace_engine(game_id, engine.clone()).await;

        persist_stage(state, game_id, &engine).await?;

        let gwp = Game::find_with_players(&state.db, game_id)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;

        UndoResult {
            accepted: true,
            engine,
            gwp,
        }
    } else {
        let engine = state
            .registry
            .get_or_init_engine(&state.db, &gwp.game)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;

        Game::set_undo_rejected(&state.db, game_id, true)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;

        let gwp = Game::find_with_players(&state.db, game_id)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;

        UndoResult {
            accepted: false,
            engine,
            gwp,
        }
    };

    // System chat
    let message = if result.accepted {
        format!("{responding_name} accepted the undo request. Move has been undone.")
    } else {
        format!("{responding_name} rejected the undo request")
    };
    broadcast_system_chat(state, game_id, &message).await;

    // Notify both players with updated state
    let kind = if result.accepted {
        "undo_accepted"
    } else {
        "undo_rejected"
    };
    let game_state = state_serializer::serialize_state(&result.gwp, &result.engine, false);
    for pid in [requesting_player_id, player_id] {
        state
            .registry
            .send_to_player(
                game_id,
                pid,
                &json!({
                    "kind": kind,
                    "state": game_state["state"],
                    "current_turn_stone": game_state["current_turn_stone"],
                    "moves": game_state["moves"],
                    "description": game_state["description"],
                    "undo_rejected": game_state["undo_rejected"],
                })
                .to_string(),
            )
            .await;
    }

    Ok(result)
}

// -- Internal helpers --

async fn broadcast_game_state(state: &AppState, game_id: i64, engine: &Engine) {
    let Ok(gwp) = Game::find_with_players(&state.db, game_id).await else {
        return;
    };

    let undo_requested = state.registry.is_undo_requested(game_id).await;
    let game_state = state_serializer::serialize_state(&gwp, engine, undo_requested);

    state
        .registry
        .broadcast(game_id, &game_state.to_string())
        .await;
}

async fn broadcast_system_chat(state: &AppState, game_id: i64, text: &str) {
    let saved = save_system_message(state, game_id, text).await.ok();
    let move_number = saved.as_ref().and_then(|m| m.move_number);
    let sent_at = saved.as_ref().map(|m| m.created_at);

    state
        .registry
        .broadcast(
            game_id,
            &json!({
                "kind": "chat",
                "sender": SYSTEM_SYMBOL,
                "text": text,
                "move_number": move_number,
                "sent_at": sent_at
            })
            .to_string(),
        )
        .await;
}

async fn save_system_message(
    state: &AppState,
    game_id: i64,
    text: &str,
) -> Result<Message, AppError> {
    let game = Game::find_by_id(&state.db, game_id)
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;
    let move_number = current_move_number(state, &game).await;
    Message::create_system(&state.db, game_id, text, move_number)
        .await
        .map_err(|e| AppError::Internal(e.to_string()))
}

async fn load_game_and_check_player(
    state: &AppState,
    game_id: i64,
    player_id: i64,
) -> Result<GameWithPlayers, AppError> {
    let gwp = Game::find_with_players(&state.db, game_id)
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;

    if !gwp.has_player(player_id) {
        return Err(AppError::BadRequest(
            "Only players can perform this action".to_string(),
        ));
    }

    Ok(gwp)
}

fn require_both_players(gwp: &GameWithPlayers) -> Result<(), AppError> {
    if gwp.is_open() {
        return Err(AppError::BadRequest(
            "Waiting for opponent to join".to_string(),
        ));
    }
    Ok(())
}

fn player_stone(gwp: &GameWithPlayers, player_id: i64) -> Result<Stone, AppError> {
    Stone::from_int(gwp.player_stone(player_id) as i8)
        .ok_or_else(|| AppError::BadRequest("You are not a player in this game".to_string()))
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
    state
        .registry
        .get_or_init_engine(&state.db, game)
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;

    match state.registry.with_engine_mut(game_id, f).await {
        Some(Ok(engine)) => Ok(engine),
        Some(Err(e)) => Err(AppError::BadRequest(e.to_string())),
        None => Err(AppError::Internal("Engine cache unavailable".to_string())),
    }
}

async fn persist_stage(state: &AppState, game_id: i64, engine: &Engine) -> Result<(), AppError> {
    Game::set_stage(&state.db, game_id, &engine.stage().to_string())
        .await
        .map_err(|e| AppError::Internal(e.to_string()))
}

async fn rollback_engine(state: &AppState, game_id: i64, game: &Game) {
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
