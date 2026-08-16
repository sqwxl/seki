use std::sync::Arc;

use go_engine::Stage;
use seki_api::ws::{ClientMsg, ControlRequestData, ServerMsg};
use serde_json::json;

use crate::AppState;
use crate::models::game::Game;
use crate::models::user::User;
use crate::services::push;
use crate::services::state_assembly;
use crate::services::{game_actions, presentation_actions};
use crate::ws::registry::WsSender;
use crate::ws::ws_msg;

fn send_to_client(tx: &WsSender, msg: &str) {
    let _ = tx.send(Arc::new(msg.to_string()));
}

/// Send the initial game state to a newly connected user.
pub async fn send_initial_state(
    state: &AppState,
    game_id: i64,
    player_id: i64,
    tokens: crate::services::game_access::GameViewTokens<'_>,
    tx: &WsSender,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let gwp = Game::find_with_players(&state.db, game_id).await?;

    // Defense in depth: join_game authorizes before room subscription.
    if !crate::services::game_access::can_view_game(&gwp, Some(player_id), tokens) {
        send_to_client(
            tx,
            &ws_msg(&ServerMsg::Error {
                game_id: Some(game_id),
                message: "Not authorized".into(),
                client_message_id: None,
            }),
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

    let loaded =
        state_assembly::load_game_state(state, &gwp, &engine, game_id, undo_requested).await?;

    let mut game_state = loaded.value;
    game_state["hydrate_only"] = json!(true);

    let can_start_pres = presentation_actions::can_start_presentation(
        &state.registry,
        game_id,
        game_is_done,
        gwp.has_player(player_id),
        gwp.black.as_ref().map(|u| u.id),
        gwp.white.as_ref().map(|u| u.id),
        gwp.game.ended_at,
    )
    .await;
    game_state["can_start_presentation"] = json!(can_start_pres);

    send_to_client(tx, &game_state.to_string());

    // If there's an active presentation, send state to the joining user
    if let Some(pres) = state.registry.get_presentation(game_id).await {
        // Auto-revert control to originator when they reconnect
        let presenter_id = if pres.originator_id == player_id && pres.presenter_id != player_id {
            state.registry.set_presenter(game_id, player_id).await;
            state
                .registry
                .broadcast(
                    game_id,
                    &ws_msg(&ServerMsg::ControlChanged {
                        game_id,
                        presenter_id: player_id,
                    }),
                )
                .await;
            player_id
        } else {
            pres.presenter_id
        };

        let msg = ws_msg(&ServerMsg::PresentationStarted {
            game_id,
            presenter_id,
            originator_id: pres.originator_id,
            snapshot: pres.cached_snapshot.clone(),
            control_request: pres.control_request.as_ref().map(|cr| ControlRequestData {
                user_id: cr.user_id,
                display_name: cr.display_name.clone(),
            }),
        });
        send_to_client(tx, &msg);
    }

    // If there's a pending undo request, send targeted UI control messages.
    // Only the actual players get them: the requester (out of turn) gets
    // undo_request_sent, the responder (on turn) gets undo_response_needed.
    if undo_requested {
        let current_turn = engine.current_turn_stone();
        let requesting_player = gwp.out_of_turn_player(current_turn);
        let turn_player = gwp.turn_player(current_turn);

        if requesting_player.is_some_and(|p| p.id == player_id) {
            send_to_client(tx, &ws_msg(&ServerMsg::UndoRequestSent { game_id }));
        } else if turn_player.is_some_and(|p| p.id == player_id) {
            let requesting_name = requesting_player
                .map(|p| p.display_name().to_string())
                .unwrap_or_else(|| "Opponent".to_string());
            send_to_client(
                tx,
                &ws_msg(&ServerMsg::UndoResponseNeeded {
                    game_id,
                    requesting_player: Some(requesting_name),
                }),
            );
        }
    }

    Ok(())
}

/// Handle an incoming game-scoped WebSocket message from a user.
pub async fn handle_message(
    state: &AppState,
    game_id: i64,
    player_id: i64,
    msg: ClientMsg,
    tx: &WsSender,
) {
    let result = match &msg {
        ClientMsg::Play {
            col,
            row,
            client_move_time_ms,
            ..
        } => handle_play(state, game_id, player_id, *col, *row, *client_move_time_ms).await,
        ClientMsg::Pass {
            client_move_time_ms,
            ..
        } => game_actions::pass(state, game_id, player_id, *client_move_time_ms)
            .await
            .map(|_| ()),
        ClientMsg::Resign { .. } => game_actions::resign(state, game_id, player_id)
            .await
            .map(|_| ()),
        ClientMsg::AcceptChallenge { .. } => {
            game_actions::accept_challenge(state, game_id, player_id).await
        }
        ClientMsg::DeclineChallenge { .. } => {
            game_actions::decline_challenge(state, game_id, player_id).await
        }
        ClientMsg::Abort { .. } => game_actions::abort(state, game_id, player_id).await,
        ClientMsg::Chat {
            message,
            client_message_id,
            ..
        } => {
            handle_chat(
                state,
                game_id,
                player_id,
                message,
                client_message_id.as_deref(),
            )
            .await
        }
        ClientMsg::RequestUndo { .. } => {
            game_actions::request_undo(state, game_id, player_id).await
        }
        ClientMsg::RespondToUndo { response, .. } => {
            handle_respond_to_undo(state, game_id, player_id, response).await
        }
        ClientMsg::ToggleChain { col, row, .. } => {
            handle_toggle_chain(state, game_id, player_id, *col, *row).await
        }
        ClientMsg::ApproveTerritory { .. } => {
            game_actions::approve_territory(state, game_id, player_id).await
        }
        ClientMsg::UpdatePregameSettings {
            handicap,
            komi,
            color,
            ..
        } => {
            game_actions::update_pregame_settings(
                state,
                game_id,
                player_id,
                *handicap,
                *komi,
                color.clone(),
            )
            .await
        }
        ClientMsg::AcceptPregameSettings { .. } => {
            game_actions::accept_pregame_settings(state, game_id, player_id).await
        }
        ClientMsg::RejectPregameSettings { .. } => {
            game_actions::reject_pregame_settings(state, game_id, player_id).await
        }
        ClientMsg::ClaimVictory { .. } => {
            game_actions::claim_victory(state, game_id, player_id).await
        }
        ClientMsg::TimeoutFlag { .. } => {
            game_actions::handle_timeout_flag(state, game_id, player_id).await
        }
        ClientMsg::TerritoryTimeoutFlag { .. } => {
            game_actions::handle_territory_timeout_flag(state, game_id, player_id).await
        }
        ClientMsg::StartPresentation { .. } => {
            presentation_actions::start_presentation(state, game_id, player_id).await
        }
        ClientMsg::EndPresentation { .. } => {
            presentation_actions::end_presentation(state, game_id, player_id).await
        }
        ClientMsg::PresentationState { snapshot, .. } => {
            handle_presentation_state(state, game_id, player_id, snapshot).await
        }
        ClientMsg::GiveControl { target_user_id, .. } => {
            handle_give_control(state, game_id, player_id, *target_user_id).await
        }
        ClientMsg::TakeControl { .. } => {
            presentation_actions::take_control(state, game_id, player_id).await
        }
        ClientMsg::RequestControl { .. } => handle_request_control(state, game_id, player_id).await,
        ClientMsg::CancelControlRequest { .. } => {
            presentation_actions::cancel_control_request(state, game_id, player_id).await
        }
        ClientMsg::RejectControlRequest { .. } => {
            presentation_actions::reject_control_request(state, game_id, player_id).await
        }
        // Transport-level messages never reach game_channel (live.rs routes them
        // first); this arm only satisfies exhaustiveness.
        ClientMsg::Bye
        | ClientMsg::Ping
        | ClientMsg::JoinGame { .. }
        | ClientMsg::LeaveGame { .. }
        | ClientMsg::SubscribePresence { .. } => {
            unreachable!("transport message routed to game_channel: {:?}", msg)
        }
    };

    if result.is_ok() {
        let _ = dispatch_push_notification(state, game_id, player_id, &msg).await;
    }

    if let Err(e) = result {
        tracing::error!("Error handling game message: {e}");
        let client_message_id = match &msg {
            ClientMsg::Chat {
                client_message_id, ..
            } => client_message_id.clone(),
            _ => None,
        };
        send_to_client(
            tx,
            &ws_msg(&ServerMsg::Error {
                game_id: Some(game_id),
                message: e.to_string(),
                client_message_id,
            }),
        );
    }
}

async fn dispatch_push_notification(
    state: &AppState,
    game_id: i64,
    actor_id: i64,
    msg: &ClientMsg,
) {
    let Ok(gwp) = Game::find_with_players(&state.db, game_id).await else {
        tracing::warn!("push: game {game_id} not found");
        return;
    };

    let opponent_id = if gwp.black.as_ref().is_some_and(|p| p.id == actor_id) {
        gwp.white.as_ref().map(|p| p.id)
    } else if gwp.white.as_ref().is_some_and(|p| p.id == actor_id) {
        gwp.black.as_ref().map(|p| p.id)
    } else {
        None
    };

    let Some(target_id) = opponent_id else {
        tracing::warn!("push: no opponent found for actor {actor_id} in game {game_id}");
        return;
    };

    let Ok(actor) = User::find_by_id(&state.db, actor_id).await else {
        tracing::warn!("push: actor {actor_id} not found");
        return;
    };
    let actor_username = actor.username;

    let (event_type, title, url) = match msg {
        ClientMsg::Play { .. } | ClientMsg::Pass { .. } => (
            "your_turn",
            format!("{actor_username} played, it's your turn"),
            format!("/games/{game_id}"),
        ),
        ClientMsg::AcceptChallenge { .. } => (
            "challenge_accepted",
            format!("{actor_username} accepted your challenge"),
            format!("/games/{game_id}"),
        ),
        ClientMsg::Chat { .. } => (
            "new_message",
            format!("New message from {actor_username}"),
            format!("/games/{game_id}#chat"),
        ),
        ClientMsg::RequestUndo { .. } => (
            "undo_request",
            format!("{actor_username} requests an undo"),
            format!("/games/{game_id}"),
        ),
        _ => return,
    };

    push::send_notification(state, target_id, event_type, &title, &url, game_id).await;
}

async fn handle_play(
    state: &AppState,
    game_id: i64,
    player_id: i64,
    col: i32,
    row: i32,
    client_move_time_ms: Option<i64>,
) -> Result<(), crate::error::AppError> {
    game_actions::play_move(state, game_id, player_id, col, row, client_move_time_ms).await?;
    Ok(())
}

async fn handle_chat(
    state: &AppState,
    game_id: i64,
    player_id: i64,
    message: &str,
    client_message_id: Option<&str>,
) -> Result<(), crate::error::AppError> {
    game_actions::send_chat(state, game_id, player_id, message, client_message_id).await?;
    Ok(())
}

async fn handle_toggle_chain(
    state: &AppState,
    game_id: i64,
    player_id: i64,
    col: u8,
    row: u8,
) -> Result<(), crate::error::AppError> {
    game_actions::toggle_chain(state, game_id, player_id, col, row).await
}

async fn handle_respond_to_undo(
    state: &AppState,
    game_id: i64,
    player_id: i64,
    response: &str,
) -> Result<(), crate::error::AppError> {
    let response = response.trim().to_lowercase();

    if response != "accept" && response != "reject" {
        return Err(crate::error::AppError::UnprocessableEntity(
            "Invalid response. Must be 'accept' or 'reject'".to_string(),
        ));
    }

    game_actions::respond_to_undo(state, game_id, player_id, response == "accept").await?;
    Ok(())
}

async fn handle_presentation_state(
    state: &AppState,
    game_id: i64,
    player_id: i64,
    snapshot: &str,
) -> Result<(), crate::error::AppError> {
    presentation_actions::update_snapshot(state, game_id, player_id, snapshot.to_string()).await
}

async fn handle_give_control(
    state: &AppState,
    game_id: i64,
    player_id: i64,
    target_user_id: i64,
) -> Result<(), crate::error::AppError> {
    presentation_actions::give_control(state, game_id, player_id, target_user_id).await
}

async fn handle_request_control(
    state: &AppState,
    game_id: i64,
    player_id: i64,
) -> Result<(), crate::error::AppError> {
    let user = User::find_by_id(&state.db, player_id)
        .await
        .map_err(|e| crate::error::AppError::Internal(e.to_string()))?;

    presentation_actions::request_control(state, game_id, player_id, user.display_name()).await
}
