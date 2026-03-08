use chrono::Utc;
use serde_json::json;

use crate::AppState;
use crate::error::AppError;
use crate::models::game::Game;
use crate::ws::registry::GameRegistry;

/// Check whether a user is eligible to start a presentation for a game.
pub async fn can_start_presentation(
    registry: &GameRegistry,
    game_id: i64,
    is_finished: bool,
    is_player: bool,
    black_id: Option<i64>,
    white_id: Option<i64>,
    ended_at: Option<chrono::DateTime<chrono::Utc>>,
) -> bool {
    if !is_finished {
        return false;
    }
    if registry.get_presentation(game_id).await.is_some() {
        return false;
    }
    if is_player {
        return true;
    }
    // Spectator eligibility
    let has_had = registry.has_had_presentation(game_id).await;
    let black_in = if let Some(id) = black_id {
        registry.is_in_room(game_id, id).await
    } else {
        false
    };
    let white_in = if let Some(id) = white_id {
        registry.is_in_room(game_id, id).await
    } else {
        false
    };
    let neither_player_in_room = !black_in && !white_in;
    let game_old_enough = ended_at.is_some_and(|ended| (Utc::now() - ended).num_hours() >= 24);

    has_had || neither_player_in_room || game_old_enough
}

pub async fn start_presentation(
    state: &AppState,
    game_id: i64,
    user_id: i64,
) -> Result<(), AppError> {
    let gwp = Game::find_with_players(&state.db, game_id).await?;

    // Game must be finished
    if gwp.game.result.is_none() {
        return Err(AppError::UnprocessableEntity(
            "Game is not finished".to_string(),
        ));
    }

    // No active presentation
    if state.registry.get_presentation(game_id).await.is_some() {
        return Err(AppError::UnprocessableEntity(
            "A presentation is already active".to_string(),
        ));
    }

    // Eligibility check
    let is_player = gwp.has_player(user_id);
    if !is_player {
        let has_had = state.registry.has_had_presentation(game_id).await;
        let neither_player_in_room = !is_any_player_in_room(state, &gwp).await;
        let game_old_enough = gwp
            .game
            .ended_at
            .is_some_and(|ended| (Utc::now() - ended).num_hours() >= 24);

        if !has_had && !neither_player_in_room && !game_old_enough {
            return Err(AppError::UnprocessableEntity(
                "Not eligible to start a presentation".to_string(),
            ));
        }
    }

    state.registry.start_presentation(game_id, user_id).await;

    state
        .registry
        .broadcast(
            game_id,
            &json!({
                "kind": "presentation_started",
                "game_id": game_id,
                "presenter_id": user_id,
                "originator_id": user_id,
                "snapshot": "",
            })
            .to_string(),
        )
        .await;

    Ok(())
}

pub async fn end_presentation(
    state: &AppState,
    game_id: i64,
    user_id: i64,
) -> Result<(), AppError> {
    let pres = state
        .registry
        .get_presentation(game_id)
        .await
        .ok_or_else(|| AppError::UnprocessableEntity("No active presentation".to_string()))?;

    if pres.presenter_id != user_id {
        return Err(AppError::UnprocessableEntity(
            "Only the presenter can end the presentation".to_string(),
        ));
    }

    state.registry.end_presentation(game_id).await;

    state
        .registry
        .broadcast(
            game_id,
            &json!({
                "kind": "presentation_ended",
                "game_id": game_id,
            })
            .to_string(),
        )
        .await;

    Ok(())
}

pub async fn update_snapshot(
    state: &AppState,
    game_id: i64,
    user_id: i64,
    snapshot: String,
) -> Result<(), AppError> {
    let pres = state
        .registry
        .get_presentation(game_id)
        .await
        .ok_or_else(|| AppError::UnprocessableEntity("No active presentation".to_string()))?;

    if pres.presenter_id != user_id {
        return Err(AppError::UnprocessableEntity(
            "Only the presenter can send state".to_string(),
        ));
    }

    state
        .registry
        .update_presentation_snapshot(game_id, snapshot.clone())
        .await;

    // Relay to everyone except the presenter
    state
        .registry
        .broadcast_except(
            game_id,
            user_id,
            &json!({
                "kind": "presentation_update",
                "game_id": game_id,
                "snapshot": snapshot,
            })
            .to_string(),
        )
        .await;

    Ok(())
}

pub async fn give_control(
    state: &AppState,
    game_id: i64,
    user_id: i64,
    target_user_id: i64,
) -> Result<(), AppError> {
    let pres = state
        .registry
        .get_presentation(game_id)
        .await
        .ok_or_else(|| AppError::UnprocessableEntity("No active presentation".to_string()))?;

    if pres.presenter_id != user_id && pres.originator_id != user_id {
        return Err(AppError::UnprocessableEntity(
            "Only the presenter or originator can give control".to_string(),
        ));
    }

    if !state.registry.is_in_room(game_id, target_user_id).await {
        return Err(AppError::UnprocessableEntity(
            "Target user is not in the room".to_string(),
        ));
    }

    state.registry.set_presenter(game_id, target_user_id).await;

    state
        .registry
        .broadcast(
            game_id,
            &json!({
                "kind": "control_changed",
                "game_id": game_id,
                "presenter_id": target_user_id,
            })
            .to_string(),
        )
        .await;

    Ok(())
}

pub async fn take_control(state: &AppState, game_id: i64, user_id: i64) -> Result<(), AppError> {
    let pres = state
        .registry
        .get_presentation(game_id)
        .await
        .ok_or_else(|| AppError::UnprocessableEntity("No active presentation".to_string()))?;

    if pres.originator_id != user_id {
        return Err(AppError::UnprocessableEntity(
            "Only the originator can take control".to_string(),
        ));
    }

    state.registry.set_presenter(game_id, user_id).await;

    state
        .registry
        .broadcast(
            game_id,
            &json!({
                "kind": "control_changed",
                "game_id": game_id,
                "presenter_id": user_id,
            })
            .to_string(),
        )
        .await;

    Ok(())
}

pub async fn request_control(
    state: &AppState,
    game_id: i64,
    user_id: i64,
    display_name: &str,
) -> Result<(), AppError> {
    let pres = state
        .registry
        .get_presentation(game_id)
        .await
        .ok_or_else(|| AppError::UnprocessableEntity("No active presentation".to_string()))?;

    if pres.presenter_id == user_id {
        return Err(AppError::UnprocessableEntity(
            "You are already the presenter".to_string(),
        ));
    }

    if pres.control_request.is_some() {
        return Err(AppError::UnprocessableEntity(
            "A control request is already pending".to_string(),
        ));
    }

    state
        .registry
        .set_control_request(game_id, Some(user_id))
        .await;

    state
        .registry
        .broadcast(
            game_id,
            &json!({
                "kind": "control_requested",
                "game_id": game_id,
                "user_id": user_id,
                "display_name": display_name,
            })
            .to_string(),
        )
        .await;

    Ok(())
}

pub async fn cancel_control_request(
    state: &AppState,
    game_id: i64,
    user_id: i64,
) -> Result<(), AppError> {
    let pres = state
        .registry
        .get_presentation(game_id)
        .await
        .ok_or_else(|| AppError::UnprocessableEntity("No active presentation".to_string()))?;

    if pres.control_request != Some(user_id) {
        return Err(AppError::UnprocessableEntity(
            "You don't have a pending control request".to_string(),
        ));
    }

    state.registry.set_control_request(game_id, None).await;

    state
        .registry
        .broadcast(
            game_id,
            &json!({
                "kind": "control_request_cancelled",
                "game_id": game_id,
            })
            .to_string(),
        )
        .await;

    Ok(())
}

pub async fn reject_control_request(
    state: &AppState,
    game_id: i64,
    user_id: i64,
) -> Result<(), AppError> {
    let pres = state
        .registry
        .get_presentation(game_id)
        .await
        .ok_or_else(|| AppError::UnprocessableEntity("No active presentation".to_string()))?;

    if pres.originator_id != user_id && pres.presenter_id != user_id {
        return Err(AppError::UnprocessableEntity(
            "Not authorized to reject control request".to_string(),
        ));
    }

    if pres.control_request.is_none() {
        return Err(AppError::UnprocessableEntity(
            "No pending control request".to_string(),
        ));
    }

    state.registry.set_control_request(game_id, None).await;

    state
        .registry
        .broadcast(
            game_id,
            &json!({
                "kind": "control_request_cancelled",
                "game_id": game_id,
            })
            .to_string(),
        )
        .await;

    Ok(())
}

/// Called when a user leaves the room (leave_game or WS disconnect cleanup).
/// If the user was the presenter, determines a fallback or ends the presentation.
pub async fn handle_presenter_left(state: &AppState, game_id: i64, user_id: i64) {
    let pres = match state.registry.get_presentation(game_id).await {
        Some(p) => p,
        None => return,
    };

    if pres.presenter_id != user_id {
        return;
    }

    // Determine fallback presenter
    let gwp = match Game::find_with_players(&state.db, game_id).await {
        Ok(g) => g,
        Err(_) => {
            // Can't look up game; just end the presentation
            state.registry.end_presentation(game_id).await;
            state
                .registry
                .broadcast(
                    game_id,
                    &json!({"kind": "presentation_ended", "game_id": game_id}).to_string(),
                )
                .await;
            return;
        }
    };

    let black_id = gwp.game.black_id;
    let white_id = gwp.game.white_id;
    let originator_id = pres.originator_id;

    // Build fallback candidate: if presenter was originator, try the other player;
    // otherwise try the originator.
    let fallback = if user_id == originator_id {
        // Presenter was originator -> try other player
        let other = if black_id == Some(user_id) {
            white_id
        } else {
            black_id
        };
        other.filter(|&id| id != user_id)
    } else {
        // Presenter was spectator or the other player -> try originator
        Some(originator_id)
    };

    // Check if the fallback candidate is still in the room
    let new_presenter = match fallback {
        Some(id) if state.registry.is_in_room(game_id, id).await => Some(id),
        _ => None,
    };

    match new_presenter {
        Some(id) => {
            state.registry.set_presenter(game_id, id).await;
            state
                .registry
                .broadcast(
                    game_id,
                    &json!({
                        "kind": "control_changed",
                        "game_id": game_id,
                        "presenter_id": id,
                    })
                    .to_string(),
                )
                .await;
        }
        None => {
            state.registry.end_presentation(game_id).await;
            state
                .registry
                .broadcast(
                    game_id,
                    &json!({"kind": "presentation_ended", "game_id": game_id}).to_string(),
                )
                .await;
        }
    }
}

async fn is_any_player_in_room(
    state: &AppState,
    gwp: &crate::models::game::GameWithPlayers,
) -> bool {
    let black_in = if let Some(id) = gwp.game.black_id {
        state.registry.is_in_room(gwp.game.id, id).await
    } else {
        false
    };
    let white_in = if let Some(id) = gwp.game.white_id {
        state.registry.is_in_room(gwp.game.id, id).await
    } else {
        false
    };
    black_in || white_in
}
