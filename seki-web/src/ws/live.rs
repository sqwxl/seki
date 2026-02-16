use axum::extract::ws::{Message, WebSocket};
use axum::extract::{State, WebSocketUpgrade};
use axum::response::Response;
use futures_util::{SinkExt, StreamExt};
use serde_json::json;

use crate::error::AppError;
use crate::models::game::Game;
use crate::services::live::LiveGameItem;
use crate::session::CurrentPlayer;
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

    // Subscribe to live broadcasts *before* querying DB to avoid missing events
    let mut live_rx = state.live_tx.subscribe();

    // Send initial state
    let init = build_init_message(&state, player_id).await;
    if ws_sink.send(Message::Text(init.into())).await.is_err() {
        return;
    }

    // Forward live broadcasts to this client
    let send_task = tokio::spawn(async move {
        loop {
            match live_rx.recv().await {
                Ok(msg) => {
                    if ws_sink.send(Message::Text(msg.into())).await.is_err() {
                        break;
                    }
                }
                Err(tokio::sync::broadcast::error::RecvError::Lagged(n)) => {
                    tracing::warn!("Live WS lagged by {n} messages for player={player_id}");
                }
                Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
            }
        }
    });

    // Consume incoming messages (keep connection alive, drain pings)
    while let Some(Ok(msg)) = ws_stream.next().await {
        if matches!(msg, Message::Close(_)) {
            break;
        }
    }

    send_task.abort();
    tracing::debug!("Live WS closed: player={player_id}");
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
