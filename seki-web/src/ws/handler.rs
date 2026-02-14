use axum::extract::ws::{Message, WebSocket};
use axum::extract::{Path, State, WebSocketUpgrade};
use axum::response::Response;
use futures_util::{SinkExt, StreamExt};
use tokio::sync::mpsc;

use crate::error::AppError;
use crate::models::game::Game;
use crate::session::CurrentPlayer;
use crate::ws::game_channel;
use crate::AppState;

/// WebSocket upgrade handler: GET /games/:id/ws
pub async fn ws_upgrade(
    State(state): State<AppState>,
    current_player: CurrentPlayer,
    Path(game_id): Path<i64>,
    ws: WebSocketUpgrade,
) -> Result<Response, AppError> {
    // Verify game exists
    Game::find_by_id(&state.db, game_id).await?;

    Ok(ws.on_upgrade(move |socket| handle_socket(socket, state, game_id, current_player.id)))
}

async fn handle_socket(socket: WebSocket, state: AppState, game_id: i64, player_id: i64) {
    let (mut ws_sink, mut ws_stream) = socket.split();

    // Create a channel for sending messages back to this client
    let (tx, mut rx) = mpsc::unbounded_channel::<String>();

    // Register in the game room
    state.registry.join(game_id, player_id, tx.clone()).await;

    // Send initial state
    if let Err(e) = game_channel::send_initial_state(&state, game_id, player_id, &tx).await {
        tracing::error!("Failed to send initial state: {e}");
        let _ = tx.send(
            serde_json::json!({"kind": "error", "message": "Failed to load game state"})
                .to_string(),
        );
    }

    // Spawn task to forward messages from the channel to the WebSocket
    let send_task = tokio::spawn(async move {
        while let Some(msg) = rx.recv().await {
            if ws_sink.send(Message::Text(msg.into())).await.is_err() {
                break;
            }
        }
    });

    // Process incoming messages
    while let Some(Ok(msg)) = ws_stream.next().await {
        match msg {
            Message::Text(text) => {
                let text_str: &str = &text;
                if let Ok(data) = serde_json::from_str::<serde_json::Value>(text_str) {
                    game_channel::handle_message(&state, game_id, player_id, &data, &tx).await;
                }
            }
            Message::Close(_) => break,
            _ => {}
        }
    }

    // Cleanup
    state.registry.leave(game_id, player_id, &tx).await;
    send_task.abort();

    tracing::debug!("WebSocket closed: game={game_id} player={player_id}");
}
