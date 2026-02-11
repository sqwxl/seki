use go_engine::{Engine, Stage, Stone};
use serde_json::json;

use crate::models::game::{Game, GameWithPlayers};
use crate::models::message::Message;
use crate::models::turn::TurnRow;
use crate::services::{engine_builder, state_serializer};
use crate::ws::registry::WsSender;
use crate::AppState;

/// Send the initial game state to a newly connected player.
pub async fn send_initial_state(
    state: &AppState,
    game_id: i64,
    player_id: i64,
    tx: &WsSender,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let gwp = Game::find_with_players(&state.db, game_id).await?;

    // Authorization: private games only allow players
    if gwp.game.is_private && !gwp.has_player(player_id) {
        let _ = tx.send(json!({"kind": "error", "message": "Not authorized"}).to_string());
        return Ok(());
    }

    let engine = state
        .registry
        .get_or_init_engine(game_id, &state.db, &gwp.game)
        .await?;
    let game_state = state_serializer::serialize_state(&gwp, &engine);

    let _ = tx.send(
        json!({
            "kind": "state",
            "stage": game_state["stage"],
            "state": game_state["state"],
            "negotiations": game_state["negotiations"],
            "current_turn_stone": game_state["current_turn_stone"]
        })
        .to_string(),
    );

    // If there's a pending undo request, send targeted messages
    if gwp.has_pending_undo_request() {
        let requesting_id = gwp.game.undo_requesting_player_id.unwrap();
        if requesting_id == player_id {
            let _ = tx.send(
                json!({
                    "kind": "undo_request_sent",
                    "stage": game_state["stage"],
                    "state": game_state["state"],
                    "current_turn_stone": game_state["current_turn_stone"],
                    "message": "Undo request sent. Waiting for opponent response..."
                })
                .to_string(),
            );
        } else {
            let requesting_name = gwp
                .undo_requesting_player
                .as_ref()
                .map(|p| p.display_name())
                .unwrap_or("Opponent");
            let _ = tx.send(
                json!({
                    "kind": "undo_response_needed",
                    "stage": game_state["stage"],
                    "state": game_state["state"],
                    "current_turn_stone": game_state["current_turn_stone"],
                    "requesting_player": requesting_name,
                    "message": format!("{requesting_name} has requested to undo their last move")
                })
                .to_string(),
            );
        }
    }

    Ok(())
}

/// Handle an incoming WebSocket message from a player.
pub async fn handle_message(
    state: &AppState,
    game_id: i64,
    player_id: i64,
    data: &serde_json::Value,
    tx: &WsSender,
) {
    let action = data.get("action").and_then(|v| v.as_str()).unwrap_or("");

    let result = match action {
        "play" => handle_play(state, game_id, player_id, data).await,
        "pass" => handle_pass(state, game_id, player_id).await,
        "resign" => handle_resign(state, game_id, player_id).await,
        "chat" => handle_chat(state, game_id, player_id, data).await,
        "request_undo" => handle_request_undo(state, game_id, player_id).await,
        "respond_to_undo" => handle_respond_to_undo(state, game_id, player_id, data).await,
        _ => {
            let _ = tx.send(
                json!({"kind": "error", "message": format!("Unknown action: {action}")})
                    .to_string(),
            );
            return;
        }
    };

    if let Err(e) = result {
        tracing::error!("Error handling {action}: {e}");
        let _ = tx.send(json!({"kind": "error", "message": e}).to_string());
    }
}

async fn handle_play(
    state: &AppState,
    game_id: i64,
    player_id: i64,
    data: &serde_json::Value,
) -> Result<(), String> {
    let col = data
        .get("col")
        .and_then(|v| v.as_i64())
        .ok_or("Missing col")? as i32;
    let row = data
        .get("row")
        .and_then(|v| v.as_i64())
        .ok_or("Missing row")? as i32;

    let gwp = load_game_and_check_player(state, game_id, player_id).await?;
    let stone = Stone::from_int(gwp.player_stone(player_id) as i8)
        .expect("player stone must be Black or White");

    // Apply move on cached engine, fall back to DB build on cache miss
    let engine = apply_engine_mutation(state, game_id, &gwp.game, |engine| {
        engine.try_play(stone, (col as u8, row as u8)).map(|_| ())
    })
    .await?;

    // Persist the turn
    let turn_count = TurnRow::count_by_game_id(&state.db, game_id)
        .await
        .map_err(|e| e.to_string())?;
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
        return Err(e.to_string());
    }

    // Clear pending undo request
    if gwp.has_pending_undo_request() {
        Game::set_undo_requesting_player(&state.db, game_id, None)
            .await
            .map_err(|e| e.to_string())?;
    }

    broadcast_state_with_engine(state, game_id, &engine).await;
    Ok(())
}

async fn handle_pass(state: &AppState, game_id: i64, player_id: i64) -> Result<(), String> {
    let gwp = load_game_and_check_player(state, game_id, player_id).await?;
    let stone = Stone::from_int(gwp.player_stone(player_id) as i8)
        .expect("player stone must be Black or White");

    let engine = apply_engine_mutation(state, game_id, &gwp.game, |engine| {
        engine.try_pass(stone).map(|_| ())
    })
    .await?;

    // Persist the turn
    let turn_count = TurnRow::count_by_game_id(&state.db, game_id)
        .await
        .map_err(|e| e.to_string())?;
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
        return Err(e.to_string());
    }

    // Clear pending undo request
    if gwp.has_pending_undo_request() {
        Game::set_undo_requesting_player(&state.db, game_id, None)
            .await
            .map_err(|e| e.to_string())?;
    }

    broadcast_state_with_engine(state, game_id, &engine).await;
    Ok(())
}

async fn handle_resign(state: &AppState, game_id: i64, player_id: i64) -> Result<(), String> {
    let gwp = load_game_and_check_player(state, game_id, player_id).await?;

    if gwp.game.result.is_some() {
        return Err("The game is over".to_string());
    }

    let stone = Stone::from_int(gwp.player_stone(player_id) as i8)
        .expect("player stone must be Black or White");

    // try_resign never fails, so wrap it in Ok(())
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
                return Err(e.to_string());
            }
        }

        let turn_count = TurnRow::count_by_game_id(&state.db, game_id)
            .await
            .map_err(|e| e.to_string())?;
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
            return Err(e.to_string());
        }
    }

    broadcast_state_with_engine(state, game_id, &engine).await;
    Ok(())
}

async fn handle_chat(
    state: &AppState,
    game_id: i64,
    player_id: i64,
    data: &serde_json::Value,
) -> Result<(), String> {
    let text = data
        .get("message")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim();

    if text.is_empty() {
        return Ok(());
    }

    if text.len() > 1000 {
        return Err("Message too long (max 1000 characters)".to_string());
    }

    let gwp = Game::find_with_players(&state.db, game_id)
        .await
        .map_err(|e| e.to_string())?;

    let msg = Message::create(&state.db, game_id, player_id, text)
        .await
        .map_err(|e| e.to_string())?;

    let player = crate::models::player::Player::find_by_id(&state.db, player_id)
        .await
        .map_err(|e| e.to_string())?;

    let sender = state_serializer::sender_label(&gwp, player_id, player.username.as_deref());

    let chat_msg = json!({
        "kind": "chat",
        "sender": sender,
        "text": msg.text
    });

    state
        .registry
        .broadcast(game_id, &chat_msg.to_string())
        .await;
    Ok(())
}

async fn handle_request_undo(state: &AppState, game_id: i64, player_id: i64) -> Result<(), String> {
    let gwp = load_game_and_check_player(state, game_id, player_id).await?;

    if gwp.has_pending_undo_request() {
        return Err("An undo request is already pending".to_string());
    }

    // Basic validation: check last turn belongs to this player
    let last_turn = TurnRow::last_turn(&state.db, game_id)
        .await
        .map_err(|e| e.to_string())?;
    let last_turn = last_turn.ok_or("No turns to undo")?;
    if last_turn.player_id != player_id {
        return Err("Can only undo your own turn".to_string());
    }
    if last_turn.kind != "play" {
        return Err("Can only undo play turns".to_string());
    }

    Game::set_undo_requesting_player(&state.db, game_id, Some(player_id))
        .await
        .map_err(|e| e.to_string())?;

    // Use cached engine for serialization (read-only)
    let engine = state
        .registry
        .get_or_init_engine(game_id, &state.db, &gwp.game)
        .await
        .map_err(|e| e.to_string())?;
    let game_state = state_serializer::serialize_state(&gwp, &engine);

    let player = crate::models::player::Player::find_by_id(&state.db, player_id)
        .await
        .map_err(|e| e.to_string())?;
    let player_name = player.display_name().to_string();

    // Send "waiting" to requesting player
    state
        .registry
        .send_to_player(
            game_id,
            player_id,
            &json!({
                "kind": "undo_request_sent",
                "stage": game_state["stage"],
                "state": game_state["state"],
                "current_turn_stone": game_state["current_turn_stone"],
                "message": "Undo request sent. Waiting for opponent response..."
            })
            .to_string(),
        )
        .await;

    // Send "response needed" to opponent
    if let Some(opponent) = gwp.opponent_of(player_id) {
        state
            .registry
            .send_to_player(
                game_id,
                opponent.id,
                &json!({
                    "kind": "undo_response_needed",
                    "stage": game_state["stage"],
                    "state": game_state["state"],
                    "current_turn_stone": game_state["current_turn_stone"],
                    "requesting_player": player_name,
                    "message": format!("{player_name} has requested to undo their last move")
                })
                .to_string(),
            )
            .await;
    }

    Ok(())
}

async fn handle_respond_to_undo(
    state: &AppState,
    game_id: i64,
    player_id: i64,
    data: &serde_json::Value,
) -> Result<(), String> {
    let response = data
        .get("response")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .to_lowercase();

    if response != "accept" && response != "reject" {
        return Err("Invalid response. Must be 'accept' or 'reject'".to_string());
    }

    let gwp = load_game_and_check_player(state, game_id, player_id).await?;

    if !gwp.has_pending_undo_request() {
        return Err("No pending undo request".to_string());
    }

    let requesting_player_id = gwp.game.undo_requesting_player_id.unwrap();
    if requesting_player_id == player_id {
        return Err("Cannot respond to your own undo request".to_string());
    }

    let responding_player = crate::models::player::Player::find_by_id(&state.db, player_id)
        .await
        .map_err(|e| e.to_string())?;
    let responding_name = responding_player.display_name().to_string();

    if response == "accept" {
        // Delete the last turn
        TurnRow::delete_last(&state.db, game_id)
            .await
            .map_err(|e| e.to_string())?;
        // Clear undo request
        Game::set_undo_requesting_player(&state.db, game_id, None)
            .await
            .map_err(|e| e.to_string())?;

        // Rebuild engine from DB after undo (no undo method on Engine)
        let game = Game::find_by_id(&state.db, game_id)
            .await
            .map_err(|e| e.to_string())?;
        let engine = engine_builder::build_engine(&state.db, &game)
            .await
            .map_err(|e| e.to_string())?;
        state
            .registry
            .replace_engine(game_id, engine.clone())
            .await;

        let gwp = Game::find_with_players(&state.db, game_id)
            .await
            .map_err(|e| e.to_string())?;
        let game_state = state_serializer::serialize_state(&gwp, &engine);

        let msg = format!("{responding_name} accepted the undo request. Move has been undone.");

        // Send to both players
        for pid in [requesting_player_id, player_id] {
            state
                .registry
                .send_to_player(
                    game_id,
                    pid,
                    &json!({
                        "kind": "undo_accepted",
                        "stage": game_state["stage"],
                        "state": game_state["state"],
                        "current_turn_stone": game_state["current_turn_stone"],
                        "responding_player": responding_name,
                        "message": msg
                    })
                    .to_string(),
                )
                .await;
        }
    } else {
        // Reject: use cached engine for serialization
        let engine = state
            .registry
            .get_or_init_engine(game_id, &state.db, &gwp.game)
            .await
            .map_err(|e| e.to_string())?;

        // Track rejection in cached state
        if let Some(last_turn) = TurnRow::last_turn(&state.db, game_id)
            .await
            .map_err(|e| e.to_string())?
        {
            let turn_count = TurnRow::count_by_game_id(&state.db, game_id)
                .await
                .map_err(|e| e.to_string())?;
            let _ = engine_builder::cache_engine_state(
                &state.db,
                game_id,
                &engine,
                turn_count,
                Some(json!({"rejected_turn_id": last_turn.id})),
            )
            .await;
        }

        Game::set_undo_requesting_player(&state.db, game_id, None)
            .await
            .map_err(|e| e.to_string())?;

        let gwp = Game::find_with_players(&state.db, game_id)
            .await
            .map_err(|e| e.to_string())?;
        let game_state = state_serializer::serialize_state(&gwp, &engine);

        let msg = format!("{responding_name} rejected the undo request");

        for pid in [requesting_player_id, player_id] {
            state
                .registry
                .send_to_player(
                    game_id,
                    pid,
                    &json!({
                        "kind": "undo_rejected",
                        "stage": game_state["stage"],
                        "state": game_state["state"],
                        "current_turn_stone": game_state["current_turn_stone"],
                        "responding_player": responding_name,
                        "message": msg
                    })
                    .to_string(),
                )
                .await;
        }
    }

    Ok(())
}

// -- Helpers --

async fn load_game_and_check_player(
    state: &AppState,
    game_id: i64,
    player_id: i64,
) -> Result<GameWithPlayers, String> {
    let gwp = Game::find_with_players(&state.db, game_id)
        .await
        .map_err(|e| e.to_string())?;

    if !gwp.has_player(player_id) {
        return Err("Only players can perform this action".to_string());
    }

    Ok(gwp)
}

/// Apply a mutation to the cached engine, initializing from DB on cache miss.
async fn apply_engine_mutation<F>(
    state: &AppState,
    game_id: i64,
    game: &Game,
    f: F,
) -> Result<Engine, String>
where
    F: FnOnce(&mut Engine) -> Result<(), go_engine::GoError>,
{
    // Ensure engine is in cache before mutating
    state
        .registry
        .get_or_init_engine(game_id, &state.db, game)
        .await
        .map_err(|e| e.to_string())?;

    match state.registry.with_engine_mut(game_id, f).await {
        Some(Ok(engine)) => Ok(engine),
        Some(Err(e)) => Err(e.to_string()),
        None => Err("Engine cache unavailable".to_string()),
    }
}

/// Rollback the cached engine by rebuilding from DB.
async fn rollback_engine(state: &AppState, game_id: i64, game: &Game) {
    if let Ok(rebuilt) = engine_builder::build_engine(&state.db, game).await {
        state.registry.replace_engine(game_id, rebuilt).await;
    }
}

/// Broadcast the current game state using a pre-built engine.
async fn broadcast_state_with_engine(state: &AppState, game_id: i64, engine: &Engine) {
    let Ok(gwp) = Game::find_with_players(&state.db, game_id).await else {
        return;
    };

    let game_state = state_serializer::serialize_state(&gwp, engine);

    let msg = json!({
        "kind": "state",
        "stage": game_state["stage"],
        "state": game_state["state"],
        "negotiations": game_state["negotiations"],
        "current_turn_stone": game_state["current_turn_stone"]
    });

    state.registry.broadcast(game_id, &msg.to_string()).await;
}
