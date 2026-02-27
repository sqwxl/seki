use std::collections::HashSet;

use axum::extract::ws::{Message, WebSocket};
use axum::extract::{State, WebSocketUpgrade};
use axum::response::Response;
use chrono::Utc;
use futures_util::{SinkExt, StreamExt};
use serde_json::json;
use tokio::sync::mpsc;

use crate::AppState;
use crate::error::AppError;
use crate::models::game::Game;
use crate::models::game_read::GameRead;
use crate::models::turn::TurnRow;
use crate::models::user::User;
use crate::services::clock::{self, TimeControl};
use crate::services::live::build_live_items;
use crate::services::presentation_actions;
use crate::session::CurrentUser;
use crate::templates::UserData;
use crate::ws::game_channel;

/// WebSocket upgrade handler: GET /live
pub async fn ws_upgrade(
    State(state): State<AppState>,
    current_user: CurrentUser,
    ws: WebSocketUpgrade,
) -> Result<Response, AppError> {
    Ok(ws.on_upgrade(move |socket| handle_live_socket(socket, state, current_user.id)))
}

async fn handle_live_socket(socket: WebSocket, state: AppState, user_id: i64) {
    let (mut ws_sink, mut ws_stream) = socket.split();

    // -- Global presence: register connection --
    let timer_was_pending = state.presence.connect(user_id).await;
    // Check if we were marked disconnected in any game room (timer may have already fired)
    let was_disconnected = timer_was_pending
        || !state
            .registry
            .games_with_disconnected_player(user_id)
            .await
            .is_empty();
    if was_disconnected {
        handle_reconnect(&state, user_id).await;
    }

    // Channel for game room messages (registered in registry per game)
    let (tx, mut rx) = mpsc::unbounded_channel::<String>();

    // Subscribe to lobby broadcasts *before* querying DB to avoid missing events
    let mut live_rx = state.live_tx.subscribe();

    // Send lobby init
    let init = build_init_message(&state, user_id).await;
    if ws_sink.send(Message::Text(init.into())).await.is_err() {
        register_disconnect(&state, user_id);
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
                            tracing::warn!("Live WS lagged by {n} messages for user={user_id}");
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
                                    state.registry.join(game_id, user_id, tx.clone()).await;
                                    subscribed_games.insert(game_id);

                                    // Notify others that this user came online (include user data)
                                    let user_data = User::find_by_id(&state.db, user_id).await.ok().map(|u| UserData::from(&u));
                                    state.registry.broadcast(game_id, &json!({"kind":"presence","player_id":user_id,"online":true,"user":user_data}).to_string()).await;

                                    if let Err(e) = game_channel::send_initial_state(
                                        &state, game_id, user_id, &tx,
                                    )
                                    .await
                                    {
                                        tracing::error!(
                                            "Failed to send initial state for game {game_id}: {e}"
                                        );
                                    }

                                    // Mark game as read at current move count
                                    let mc = TurnRow::count_by_game_ids(&state.db, &[game_id])
                                        .await
                                        .unwrap_or_default()
                                        .get(&game_id)
                                        .copied()
                                        .unwrap_or(0);
                                    GameRead::upsert(&state.db, user_id, game_id, mc as i32)
                                        .await
                                        .ok();
                                }
                            }
                        }
                        "leave_game" => {
                            if let Some(game_id) = data.get("game_id").and_then(|v| v.as_i64()) {
                                let removed = state.registry.leave(game_id, user_id, &tx).await;
                                subscribed_games.remove(&game_id);
                                if removed {
                                    state.registry.broadcast(game_id, &json!({"kind":"presence","player_id":user_id,"online":false}).to_string()).await;
                                    presentation_actions::handle_presenter_left(&state, game_id, user_id).await;
                                }
                            }
                        }
                        _ => {
                            // Game action: route to game_channel
                            if let Some(game_id) = data.get("game_id").and_then(|v| v.as_i64())
                                && subscribed_games.contains(&game_id)
                            {
                                game_channel::handle_message(&state, game_id, user_id, &data, &tx)
                                    .await;
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
    for game_id in &subscribed_games {
        let removed = state.registry.leave(*game_id, user_id, &tx).await;
        if removed {
            state
                .registry
                .broadcast(
                    *game_id,
                    &json!({"kind":"presence","player_id":user_id,"online":false}).to_string(),
                )
                .await;
            presentation_actions::handle_presenter_left(&state, *game_id, user_id).await;
        }
    }
    send_task.abort();

    // -- Global presence: deregister connection --
    register_disconnect(&state, user_id);
}

/// Start the grace-period disconnect timer for a user.
fn register_disconnect(state: &AppState, user_id: i64) {
    let state_for_task = state.clone();
    let state_for_callback = state.clone();
    // `presence.disconnect` is async but we're in a sync-ish cleanup context.
    // Spawn a small task to call it.
    tokio::spawn(async move {
        state_for_task
            .presence
            .disconnect(user_id, move |uid| {
                // Grace period expired — fire disconnect logic
                tokio::spawn(async move {
                    handle_disconnect(&state_for_callback, uid).await;
                });
            })
            .await;
    });
}

/// Called after grace period expires: pause clocks and broadcast disconnect.
async fn handle_disconnect(state: &AppState, user_id: i64) {
    let game_ids = match Game::active_timed_game_ids(&state.db, user_id).await {
        Ok(ids) => ids,
        Err(e) => {
            tracing::error!("Failed to query active timed games for disconnect: {e}");
            return;
        }
    };

    let now = Utc::now();

    for game_id in game_ids {
        state.registry.mark_disconnected(game_id, user_id, now).await;

        // Pause the disconnected player's clock if it's active
        let game = match Game::find_by_id(&state.db, game_id).await {
            Ok(g) => g,
            Err(_) => continue,
        };
        let tc = TimeControl::from_game(&game);
        if !tc.is_none() {
            if let Some(mut clock) = state.registry.get_clock(game_id).await {
                let active = clock::active_stone_from_stage(&game.stage);
                // Only pause if the disconnected player's clock is the active one
                let disconnected_stone = if game.black_id == Some(user_id) {
                    Some(go_engine::Stone::Black)
                } else if game.white_id == Some(user_id) {
                    Some(go_engine::Stone::White)
                } else {
                    None
                };

                if active == disconnected_stone && disconnected_stone.is_some() {
                    clock.pause(active, now);
                    state.registry.update_clock(game_id, clock.clone()).await;
                    // Persist paused clock to DB
                    let _ = Game::update_clock(
                        &state.db,
                        game_id,
                        &clock.to_update(None, &tc),
                    )
                    .await;
                }
            }
        }

        // Broadcast disconnect to all viewers in the game room
        state
            .registry
            .broadcast(
                game_id,
                &json!({
                    "kind": "player_disconnected",
                    "game_id": game_id,
                    "user_id": user_id,
                    "timestamp": now.to_rfc3339(),
                })
                .to_string(),
            )
            .await;
    }
}

/// Called when a user reconnects after being disconnected: resume clocks and broadcast.
async fn handle_reconnect(state: &AppState, user_id: i64) {
    let game_ids = state
        .registry
        .games_with_disconnected_player(user_id)
        .await;

    let now = Utc::now();

    for game_id in game_ids {
        state.registry.mark_reconnected(game_id, user_id).await;

        // Resume clock if the game is active + timed
        let game = match Game::find_by_id(&state.db, game_id).await {
            Ok(g) => g,
            Err(_) => continue,
        };

        if game.result.is_some() {
            continue;
        }

        let tc = TimeControl::from_game(&game);
        if !tc.is_none() {
            let active = clock::active_stone_from_stage(&game.stage);
            // Resume the clock for whoever's turn it is
            if active.is_some() {
                if let Some(mut clock) = state.registry.get_clock(game_id).await {
                    // Only resume if the clock is actually paused
                    if clock.last_move_at.is_none() {
                        clock.resume(now);
                        state.registry.update_clock(game_id, clock.clone()).await;
                        let _ = Game::update_clock(
                            &state.db,
                            game_id,
                            &clock.to_update(active, &tc),
                        )
                        .await;
                    }
                }
            }
        }

        // Broadcast reconnect to all viewers
        state
            .registry
            .broadcast(
                game_id,
                &json!({
                    "kind": "player_reconnected",
                    "game_id": game_id,
                    "user_id": user_id,
                })
                .to_string(),
            )
            .await;
    }
}

async fn build_init_message(state: &AppState, user_id: i64) -> String {
    let (player_games, public_games) = tokio::join!(
        Game::list_for_player(&state.db, user_id),
        Game::list_public_with_players(&state.db, Some(user_id)),
    );
    let player_games = player_games.unwrap_or_default();
    let public_games = public_games.unwrap_or_default();

    let (user_items, public_items) = tokio::join!(
        build_live_items(&state.db, &player_games),
        build_live_items(&state.db, &public_games),
    );

    // Enrich player games with unread flags
    let game_ids: Vec<i64> = player_games.iter().map(|g| g.game.id).collect();
    let reads = GameRead::find_by_user_and_games(&state.db, user_id, &game_ids)
        .await
        .unwrap_or_default();

    let user_items_enriched: Vec<serde_json::Value> = user_items
        .iter()
        .zip(player_games.iter())
        .map(|(item, gwp)| {
            let mut v = serde_json::to_value(item).unwrap();
            let is_my_turn = is_user_turn(&gwp.game, user_id);
            let last_seen = reads.get(&gwp.game.id).copied().unwrap_or(0);
            let mc = item.move_count.unwrap_or(0) as i32;
            let unread = is_my_turn && mc > last_seen;
            v.as_object_mut()
                .unwrap()
                .insert("unread".into(), serde_json::Value::Bool(unread));
            v
        })
        .collect();

    json!({
        "kind": "init",
        "player_id": user_id,
        "player_games": user_items_enriched,
        "public_games": public_items,
    })
    .to_string()
}

/// Check whether it's the given user's turn (or they need to respond to a challenge).
fn is_user_turn(game: &Game, user_id: i64) -> bool {
    match game.stage.as_str() {
        "black_to_play" => game.black_id == Some(user_id),
        "white_to_play" => game.white_id == Some(user_id),
        "challenge" => {
            // It's the invited player's turn to accept/decline
            game.creator_id != Some(user_id)
                && (game.black_id == Some(user_id) || game.white_id == Some(user_id))
        }
        _ => false,
    }
}
