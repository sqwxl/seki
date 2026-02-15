use serde_json::json;

use crate::models::game::Game;
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
        "pass" => game_actions::pass(state, game_id, player_id).await.map(|_| ()),
        "resign" => game_actions::resign(state, game_id, player_id).await.map(|_| ()),
        "chat" => handle_chat(state, game_id, player_id, data).await,
        "request_undo" => game_actions::request_undo(state, game_id, player_id).await,
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

    game_actions::play_move(state, game_id, player_id, col, row).await?;
    Ok(())
}

async fn handle_chat(
    state: &AppState,
    game_id: i64,
    player_id: i64,
    data: &serde_json::Value,
) -> Result<(), crate::error::AppError> {
    let text = data.get("message").and_then(|v| v.as_str()).unwrap_or("");
    game_actions::send_chat(state, game_id, player_id, text).await?;
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

    game_actions::respond_to_undo(state, game_id, player_id, response == "accept").await?;
    Ok(())
}
