use serde_json::json;

use crate::models::game::{Game, SYSTEM_SYMBOL};
use crate::services::game_actions;
use crate::services::state_serializer;
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
        .get_or_init_engine(&state.db, &gwp.game)
        .await?;
    let undo_requested = state.registry.is_undo_requested(game_id).await;
    let game_state = state_serializer::serialize_state(&gwp, &engine, undo_requested);

    let _ = tx.send(game_state.to_string());

    // If there's a pending undo request, send targeted UI control messages
    if undo_requested {
        let current_turn = engine.current_turn_stone();
        let requesting_player = gwp.out_of_turn_player(current_turn);

        if requesting_player.is_some_and(|p| p.id == player_id) {
            let _ = tx.send(
                json!({ "kind": "undo_request_sent" }).to_string(),
            );
        } else {
            let requesting_name = requesting_player
                .map(|p| p.display_name().to_string())
                .unwrap_or_else(|| "Opponent".to_string());
            let _ = tx.send(
                json!({
                    "kind": "undo_response_needed",
                    "requesting_player": requesting_name,
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
        let _ = tx.send(json!({"kind": "error", "message": e.to_string()}).to_string());
    }
}

async fn handle_play(
    state: &AppState,
    game_id: i64,
    player_id: i64,
    data: &serde_json::Value,
) -> Result<(), crate::error::AppError> {
    let col = data
        .get("col")
        .and_then(|v| v.as_i64())
        .ok_or_else(|| crate::error::AppError::BadRequest("Missing col".to_string()))?
        as i32;
    let row = data
        .get("row")
        .and_then(|v| v.as_i64())
        .ok_or_else(|| crate::error::AppError::BadRequest("Missing row".to_string()))?
        as i32;

    let engine = game_actions::play_move(state, game_id, player_id, col, row).await?;
    game_actions::broadcast_game_state(state, game_id, &engine).await;
    Ok(())
}

async fn handle_pass(
    state: &AppState,
    game_id: i64,
    player_id: i64,
) -> Result<(), crate::error::AppError> {
    let engine = game_actions::pass(state, game_id, player_id).await?;
    game_actions::broadcast_game_state(state, game_id, &engine).await;
    Ok(())
}

async fn handle_resign(
    state: &AppState,
    game_id: i64,
    player_id: i64,
) -> Result<(), crate::error::AppError> {
    let engine = game_actions::resign(state, game_id, player_id).await?;
    game_actions::broadcast_game_state(state, game_id, &engine).await;
    Ok(())
}

async fn handle_chat(
    state: &AppState,
    game_id: i64,
    player_id: i64,
    data: &serde_json::Value,
) -> Result<(), crate::error::AppError> {
    let text = data.get("message").and_then(|v| v.as_str()).unwrap_or("");

    let chat = game_actions::send_chat(state, game_id, player_id, text).await?;

    let chat_msg = json!({
        "kind": "chat",
        "sender": chat.sender_label,
        "text": chat.message.text,
        "move_number": chat.message.move_number,
        "sent_at": chat.message.created_at
    });

    state
        .registry
        .broadcast(game_id, &chat_msg.to_string())
        .await;
    Ok(())
}

async fn handle_request_undo(
    state: &AppState,
    game_id: i64,
    player_id: i64,
) -> Result<(), crate::error::AppError> {
    let result = game_actions::request_undo(state, game_id, player_id).await?;

    let message = format!(
        "{} requested to undo their last move",
        result.requesting_player_name
    );

    // Persist and broadcast one universal chat message
    let saved = game_actions::save_system_message(state, game_id, &message)
        .await
        .ok();
    let move_number = saved.as_ref().and_then(|m| m.move_number);
    let sent_at = saved.as_ref().map(|m| m.created_at);

    state
        .registry
        .broadcast(
            game_id,
            &json!({
                "kind": "chat",
                "sender": SYSTEM_SYMBOL,
                "text": message,
                "move_number": move_number,
                "sent_at": sent_at
            })
            .to_string(),
        )
        .await;

    // Send targeted UI control messages (no chat data)
    state
        .registry
        .send_to_player(
            game_id,
            player_id,
            &json!({ "kind": "undo_request_sent" }).to_string(),
        )
        .await;

    if let Some(opponent) = &result.opponent {
        state
            .registry
            .send_to_player(
                game_id,
                opponent.id,
                &json!({
                    "kind": "undo_response_needed",
                    "requesting_player": result.requesting_player_name,
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
) -> Result<(), crate::error::AppError> {
    let response = data
        .get("response")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .to_lowercase();

    if response != "accept" && response != "reject" {
        return Err(crate::error::AppError::BadRequest(
            "Invalid response. Must be 'accept' or 'reject'".to_string(),
        ));
    }

    let accept = response == "accept";
    let result = game_actions::respond_to_undo(state, game_id, player_id, accept).await?;

    let kind = if result.accepted {
        "undo_accepted"
    } else {
        "undo_rejected"
    };

    let message = if result.accepted {
        format!(
            "{} accepted the undo request. Move has been undone.",
            result.responding_player_name
        )
    } else {
        format!(
            "{} rejected the undo request",
            result.responding_player_name
        )
    };

    // Persist and broadcast one universal chat message
    let saved = game_actions::save_system_message(state, game_id, &message)
        .await
        .ok();
    let move_number = saved.as_ref().and_then(|m| m.move_number);
    let sent_at = saved.as_ref().map(|m| m.created_at);

    state
        .registry
        .broadcast(
            game_id,
            &json!({
                "kind": "chat",
                "sender": SYSTEM_SYMBOL,
                "text": message,
                "move_number": move_number,
                "sent_at": sent_at
            })
            .to_string(),
        )
        .await;

    // Send targeted UI/state update to both players (no chat data)
    for pid in [result.requesting_player_id, player_id] {
        state
            .registry
            .send_to_player(
                game_id,
                pid,
                &json!({
                    "kind": kind,
                    "state": result.game_state["state"],
                    "current_turn_stone": result.game_state["current_turn_stone"],
                    "moves": result.game_state["moves"],
                    "description": result.game_state["description"],
                    "undo_rejected": result.game_state["undo_rejected"],
                })
                .to_string(),
            )
            .await;
    }

    Ok(())
}
