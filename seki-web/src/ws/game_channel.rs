use go_engine::Stage;
use serde_json::json;

use crate::AppState;
use crate::models::game::Game;
use crate::services::clock::{ClockState, TimeControl};
use crate::services::game_actions;
use crate::services::state_serializer;
use crate::ws::registry::WsSender;

fn send_to_client(tx: &WsSender, msg: &str) {
    let _ = tx.send(msg.to_string());
}

/// Send the initial game state to a newly connected user.
pub async fn send_initial_state(
    state: &AppState,
    game_id: i64,
    player_id: i64,
    tx: &WsSender,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let gwp = Game::find_with_players(&state.db, game_id).await?;

    // Authorization: private games only allow users
    if gwp.game.is_private && !gwp.has_player(player_id) {
        send_to_client(
            tx,
            &json!({"kind": "error", "game_id": game_id, "message": "Not authorized"}).to_string(),
        );
        return Ok(());
    }

    let engine = state
        .registry
        .get_or_init_engine(&state.db, &gwp.game)
        .await?;

    // Restore territory review state on reconnect if needed
    // Skip if the game is already done (engine doesn't know about DB result)
    let game_is_done = gwp.game.result.is_some();
    if !game_is_done
        && engine.stage() == Stage::TerritoryReview
        && state.registry.get_territory_review(game_id).await.is_none()
    {
        let dead_stones = go_engine::territory::detect_dead_stones(engine.goban());
        state
            .registry
            .init_territory_review(game_id, dead_stones)
            .await;
    }

    let undo_requested = state.registry.is_undo_requested(game_id).await;

    let territory = if !game_is_done && engine.stage() == Stage::TerritoryReview {
        state
            .registry
            .get_territory_review(game_id)
            .await
            .map(|tr| {
                state_serializer::compute_territory_data(
                    &engine,
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

    // Load clock data for timed games (from game row)
    let tc = TimeControl::from_game(&gwp.game);
    let clock_data = if !tc.is_none() {
        let clock = match state.registry.get_clock(game_id).await {
            Some(c) => c,
            None => {
                // Load from game row on first connect
                ClockState::from_game(&gwp.game).unwrap_or_else(|| {
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

    let clock_ref = clock_data.as_ref().map(|(clock, tc)| (clock, tc));

    // Load settled territory for finished games
    let settled_territory = if gwp.game.result.is_some() && territory.is_none() {
        Game::load_settled_territory(&state.db, game_id)
            .await
            .ok()
            .flatten()
            .map(|raw| state_serializer::build_settled_territory(&engine, gwp.game.komi, raw))
    } else {
        None
    };

    let online_users = state.registry.get_online_user_ids(game_id).await;
    let game_state = state_serializer::serialize_state(
        &gwp,
        &engine,
        undo_requested,
        territory.as_ref(),
        settled_territory.as_ref(),
        clock_ref,
        &online_users,
    );

    send_to_client(tx, &game_state.to_string());

    // If there's a pending undo request, send targeted UI control messages
    if undo_requested {
        let current_turn = engine.current_turn_stone();
        let requesting_player = gwp.out_of_turn_player(current_turn);

        if requesting_player.is_some_and(|p| p.id == player_id) {
            send_to_client(
                tx,
                &json!({ "kind": "undo_request_sent", "game_id": game_id }).to_string(),
            );
        } else {
            let requesting_name = requesting_player
                .map(|p| p.display_name().to_string())
                .unwrap_or_else(|| "Opponent".to_string());
            send_to_client(
                tx,
                &json!({
                    "kind": "undo_response_needed",
                    "game_id": game_id,
                    "requesting_player": requesting_name,
                })
                .to_string(),
            );
        }
    }

    Ok(())
}

/// Handle an incoming WebSocket message from a user.
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
        "pass" => game_actions::pass(state, game_id, player_id)
            .await
            .map(|_| ()),
        "resign" => game_actions::resign(state, game_id, player_id)
            .await
            .map(|_| ()),
        "accept_challenge" => {
            game_actions::accept_challenge(state, game_id, player_id).await
        }
        "decline_challenge" => {
            game_actions::decline_challenge(state, game_id, player_id).await
        }
        "abort" => game_actions::abort(state, game_id, player_id).await,
        "chat" => handle_chat(state, game_id, player_id, data).await,
        "request_undo" => game_actions::request_undo(state, game_id, player_id).await,
        "respond_to_undo" => handle_respond_to_undo(state, game_id, player_id, data).await,
        "toggle_chain" => handle_toggle_chain(state, game_id, player_id, data).await,
        "approve_territory" => game_actions::approve_territory(state, game_id, player_id).await,
        "disconnect_abort" => game_actions::disconnect_abort(state, game_id, player_id).await,
        "timeout_flag" => game_actions::handle_timeout_flag(state, game_id, player_id).await,
        "territory_timeout_flag" => {
            game_actions::handle_territory_timeout_flag(state, game_id, player_id).await
        }
        _ => {
            send_to_client(
                tx,
                &json!({"kind": "error", "game_id": game_id, "message": format!("Unknown action: {action}")}).to_string(),
            );
            return;
        }
    };

    if let Err(e) = result {
        tracing::error!("Error handling {action}: {e}");
        send_to_client(
            tx,
            &json!({"kind": "error", "game_id": game_id, "message": e.to_string()}).to_string(),
        );
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
