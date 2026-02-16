use std::collections::HashSet;

use axum::extract::ws::{Message, WebSocket};
use axum::extract::{State, WebSocketUpgrade};
use axum::response::Response;
use futures_util::{SinkExt, StreamExt};
use serde_json::json;
use tokio::sync::mpsc;

use crate::error::AppError;
use crate::models::game::Game;
use crate::services::live::LiveGameItem;
use crate::session::CurrentPlayer;
use crate::ws::game_channel;
use crate::AppState;

/// WebSocket upgrade handler: GET /live
pub async fn ws_upgrade(
    State(state): State<AppState>,
    current_player: CurrentPlayer,
    ws: WebSocketUpgrade,
) -> Result<Response, AppError> {
    Ok(ws.on_upgrade(move |socket| handle_live_socket(socket, state, current_player.id)))
}

async fn handle_live_socket(socket: WebSocket, state: AppState, player_id: i64) {
    let (mut ws_sink, mut ws_stream) = socket.split();

    // Channel for game room messages (registered in registry per game)
    let (tx, mut rx) = mpsc::unbounded_channel::<String>();

    // Subscribe to lobby broadcasts *before* querying DB to avoid missing events
    let mut live_rx = state.live_tx.subscribe();

    // Send lobby init
    let init = build_init_message(&state, player_id).await;
    if ws_sink.send(Message::Text(init.into())).await.is_err() {
        return;
    }

    // Forward task: merge lobby broadcasts and game room messages → ws_sink
    let send_task = tokio::spawn(async move {
        loop {
            tokio::select! {
                msg = rx.recv() => {
                    match msg {
                        Some(m) => {
                            if ws_sink.send(Message::Text(m.into())).await.is_err() {
                                break;
                            }
                        }
                        None => break,
                    }
                }
                msg = live_rx.recv() => {
                    match msg {
                        Ok(m) => {
                            if ws_sink.send(Message::Text(m.into())).await.is_err() {
                                break;
                            }
                        }
                        Err(tokio::sync::broadcast::error::RecvError::Lagged(n)) => {
                            tracing::warn!("Live WS lagged by {n} messages for player={player_id}");
                        }
                        Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                    }
                }
            }
        }
    });

    // Track subscribed games for cleanup
    let mut subscribed_games: HashSet<i64> = HashSet::new();

    // Process incoming client messages
    while let Some(Ok(msg)) = ws_stream.next().await {
        match msg {
            Message::Text(text) => {
                let text_str: &str = &text;
                if let Ok(data) = serde_json::from_str::<serde_json::Value>(text_str) {
                    let action = data.get("action").and_then(|v| v.as_str()).unwrap_or("");

                    match action {
                        "join_game" => {
                            if let Some(game_id) = data.get("game_id").and_then(|v| v.as_i64()) {
                                // Verify game exists
                                if Game::find_by_id(&state.db, game_id).await.is_ok() {
                                    state.registry.join(game_id, player_id, tx.clone()).await;
                                    subscribed_games.insert(game_id);

                                    if let Err(e) = game_channel::send_initial_state(
                                        &state, game_id, player_id, &tx,
                                    )
                                    .await
                                    {
                                        tracing::error!(
                                            "Failed to send initial state for game {game_id}: {e}"
                                        );
                                    }
                                }
                            }
                        }
                        "leave_game" => {
                            if let Some(game_id) = data.get("game_id").and_then(|v| v.as_i64()) {
                                state.registry.leave(game_id, player_id, &tx).await;
                                subscribed_games.remove(&game_id);
                            }
                        }
                        _ => {
                            // Game action: route to game_channel
                            if let Some(game_id) = data.get("game_id").and_then(|v| v.as_i64()) {
                                if subscribed_games.contains(&game_id) {
                                    game_channel::handle_message(
                                        &state, game_id, player_id, &data, &tx,
                                    )
                                    .await;
                                }
                            }
                        }
                    }
                }
            }
            Message::Close(_) => break,
            _ => {}
        }
    }

    // Cleanup: leave all subscribed games
    for game_id in subscribed_games {
        state.registry.leave(game_id, player_id, &tx).await;
    }
    send_task.abort();

}

async fn build_init_message(state: &AppState, player_id: i64) -> String {
    let player_games = Game::list_for_player(&state.db, player_id)
        .await
        .unwrap_or_default();
    let public_games = Game::list_public_with_players(&state.db, Some(player_id))
        .await
        .unwrap_or_default();

    let player_items: Vec<LiveGameItem> = player_games
        .iter()
        .map(|gwp| LiveGameItem::from_gwp(gwp, None))
        .collect();
    let public_items: Vec<LiveGameItem> = public_games
        .iter()
        .map(|gwp| LiveGameItem::from_gwp(gwp, None))
        .collect();

    json!({
        "kind": "init",
        "player_id": player_id,
        "player_games": player_items,
        "public_games": public_items,
    })
    .to_string()
}
