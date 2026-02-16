use go_engine::Stage;
use serde_json::json;

use crate::models::game::Game;
use crate::models::game_clock::GameClock;
use crate::services::clock::{ClockState, TimeControl};
use crate::services::game_actions;
use crate::services::state_serializer;
use crate::ws::registry::WsSender;
use crate::AppState;

/// Send a JSON value to the client with `game_id` injected.
fn send_to_client(tx: &WsSender, game_id: i64, mut msg: serde_json::Value) {
    if let Some(obj) = msg.as_object_mut() {
        obj.insert("game_id".to_string(), json!(game_id));
    }
    let _ = tx.send(msg.to_string());
}

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
        send_to_client(tx, game_id, json!({"kind": "error", "message": "Not authorized"}));
        return Ok(());
    }

    let engine = state
        .registry
        .get_or_init_engine(&state.db, &gwp.game)
        .await?;

    // Restore territory review state on reconnect if needed
    if engine.stage() == Stage::TerritoryReview
        && state.registry.get_territory_review(game_id).await.is_none()
    {
        let dead_stones = go_engine::territory::detect_dead_stones(engine.goban());
        state
            .registry
            .init_territory_review(game_id, dead_stones)
            .await;
    }

    let undo_requested = state.registry.is_undo_requested(game_id).await;

    let territory = if engine.stage() == Stage::TerritoryReview {
        state.registry.get_territory_review(game_id).await.map(|tr| {
            state_serializer::compute_territory_data(
                &engine,
                &tr.dead_stones,
                gwp.game.komi,
                tr.black_approved,
                tr.white_approved,
            )
        })
    } else {
        None
    };

    // Load clock data for timed games
    let tc = TimeControl::from_game(&gwp.game);
    let clock_data = if !tc.is_none() {
        let clock = match state.registry.get_clock(game_id).await {
            Some(c) => c,
            None => {
                // Load from DB on first connect
                GameClock::find_by_game_id(&state.db, game_id)
                    .await
                    .ok()
                    .flatten()
                    .map(|db_clock| {
                        let c = ClockState::from_db(&db_clock);
                        // Cache it — fire and forget since we can't await inside map
                        c
                    })
                    .unwrap_or_else(|| {
                        // Shouldn't happen, but fallback to fresh
                        ClockState::new(&tc).unwrap()
                    })
            }
        };
        // Ensure it's cached
        state.registry.update_clock(game_id, clock.clone()).await;
        Some((clock, tc))
    } else {
        None
    };

    let clock_ref = clock_data
        .as_ref()
        .map(|(clock, tc)| (clock, tc));

    let game_state =
        state_serializer::serialize_state(&gwp, &engine, undo_requested, territory.as_ref(), clock_ref);

    send_to_client(tx, game_id, game_state);

    // If there's a pending undo request, send targeted UI control messages
    if undo_requested {
        let current_turn = engine.current_turn_stone();
        let requesting_player = gwp.out_of_turn_player(current_turn);

        if requesting_player.is_some_and(|p| p.id == player_id) {
            send_to_client(tx, game_id, json!({ "kind": "undo_request_sent" }));
        } else {
            let requesting_name = requesting_player
                .map(|p| p.display_name().to_string())
                .unwrap_or_else(|| "Opponent".to_string());
            send_to_client(tx, game_id, json!({
                "kind": "undo_response_needed",
                "requesting_player": requesting_name,
            }));
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
        "abort" => game_actions::abort(state, game_id, player_id).await,
        "chat" => handle_chat(state, game_id, player_id, data).await,
        "request_undo" => game_actions::request_undo(state, game_id, player_id).await,
        "respond_to_undo" => handle_respond_to_undo(state, game_id, player_id, data).await,
        "toggle_chain" => handle_toggle_chain(state, game_id, player_id, data).await,
        "approve_territory" => game_actions::approve_territory(state, game_id, player_id).await,
        _ => {
            send_to_client(tx, game_id, json!({"kind": "error", "message": format!("Unknown action: {action}")}));
            return;
        }
    };

    if let Err(e) = result {
        tracing::error!("Error handling {action}: {e}");
        send_to_client(tx, game_id, json!({"kind": "error", "message": e.to_string()}));
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

async fn handle_toggle_chain(
    state: &AppState,
    game_id: i64,
    player_id: i64,
    data: &serde_json::Value,
) -> Result<(), crate::error::AppError> {
    let col = data
        .get("col")
        .and_then(|v| v.as_u64())
        .ok_or_else(|| crate::error::AppError::BadRequest("Missing col".to_string()))?
        as u8;
    let row = data
        .get("row")
        .and_then(|v| v.as_u64())
        .ok_or_else(|| crate::error::AppError::BadRequest("Missing row".to_string()))?
        as u8;

    game_actions::toggle_chain(state, game_id, player_id, col, row).await
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
