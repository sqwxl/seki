use go_engine::Engine;
use serde_json::json;

use crate::AppState;
use crate::error::AppError;
use crate::models::game::{Game, GameWithPlayers};
use crate::models::turn::TurnRow;
use crate::models::user::User;
use crate::services::clock::TimeControl;
use crate::services::{engine_builder, state_serializer};
use crate::templates::UserData;

use super::{load_game_and_check_player, persist_stage, require_not_challenge};

pub struct UndoResult {
    pub accepted: bool,
    pub engine: Engine,
    pub gwp: GameWithPlayers,
}

pub async fn request_undo(state: &AppState, game_id: i64, player_id: i64) -> Result<(), AppError> {
    let gwp = load_game_and_check_player(state, game_id, player_id).await?;
    require_not_challenge(&gwp)?;

    if gwp.game.result.is_some() {
        return Err(AppError::BadRequest("The game is over".to_string()));
    }

    if !gwp.game.allow_undo {
        return Err(AppError::BadRequest(
            "Takebacks are not allowed in this game".into(),
        ));
    }

    if state.registry.is_undo_requested(game_id).await {
        return Err(AppError::BadRequest(
            "An undo request is already pending".to_string(),
        ));
    }

    if gwp.game.undo_rejected {
        return Err(AppError::BadRequest(
            "Undo was already rejected for the current move".to_string(),
        ));
    }

    let last_turn = TurnRow::last_turn(&state.db, game_id).await?;
    let last_turn =
        last_turn.ok_or_else(|| AppError::BadRequest("No turns to undo".to_string()))?;
    if last_turn.user_id != player_id {
        return Err(AppError::BadRequest(
            "Can only undo your own turn".to_string(),
        ));
    }
    if last_turn.kind != "play" {
        return Err(AppError::BadRequest("Can only undo play turns".to_string()));
    }

    state.registry.set_undo_requested(game_id, true).await;

    let requesting_name = gwp
        .player_by_id(player_id)
        .map(|u| u.display_name().to_string())
        .unwrap_or_else(|| "Unknown".to_string());
    let opponent = gwp.opponent_of(player_id).cloned();

    // Notify requester: disable undo button
    state
        .registry
        .send_to_player(
            game_id,
            player_id,
            &json!({ "kind": "undo_request_sent", "game_id": game_id }).to_string(),
        )
        .await;

    // Notify opponent: show accept/reject controls
    if let Some(opponent) = &opponent {
        state
            .registry
            .send_to_player(
                game_id,
                opponent.id,
                &json!({
                    "kind": "undo_response_needed",
                    "game_id": game_id,
                    "requesting_player": requesting_name,
                })
                .to_string(),
            )
            .await;
    }

    Ok(())
}

pub async fn respond_to_undo(
    state: &AppState,
    game_id: i64,
    player_id: i64,
    accept: bool,
) -> Result<UndoResult, AppError> {
    let gwp = load_game_and_check_player(state, game_id, player_id).await?;

    if !state.registry.is_undo_requested(game_id).await {
        return Err(AppError::BadRequest("No pending undo request".to_string()));
    }

    // The requesting user is the one who played last (out of turn now)
    let engine = state
        .registry
        .get_or_init_engine(&state.db, &gwp.game)
        .await?;
    let requesting_player_id = gwp
        .out_of_turn_player(engine.current_turn_stone())
        .map(|p| p.id)
        .ok_or_else(|| AppError::Internal("Cannot determine requesting user".to_string()))?;

    if requesting_player_id == player_id {
        return Err(AppError::BadRequest(
            "Cannot respond to your own undo request".to_string(),
        ));
    }

    // Clear the in-memory request flag regardless of accept/reject
    state.registry.set_undo_requested(game_id, false).await;

    let result = if accept {
        // Delete turn + rebuild engine + set stage atomically
        let mut tx = state.db.begin().await?;

        TurnRow::delete_last(&mut *tx, game_id).await?;

        // Rebuild engine within the transaction so reads see the deleted turn
        let game = Game::find_by_id(&mut *tx, game_id).await?;
        let db_turns = TurnRow::find_by_game_id(&mut *tx, game_id).await?;
        let turns = engine_builder::convert_turns(&db_turns);
        let engine = Engine::with_handicap_and_moves(
            game.cols as u8,
            game.rows as u8,
            game.handicap as u8,
            turns,
        );

        persist_stage(&mut *tx, game_id, &engine).await?;
        engine_builder::cache_engine_state(&mut *tx, game_id, &engine, db_turns.len() as i64, None)
            .await?;

        tx.commit().await?;

        state.registry.replace_engine(game_id, engine.clone()).await;

        let gwp = Game::find_with_players(&state.db, game_id).await?;

        UndoResult {
            accepted: true,
            engine,
            gwp,
        }
    } else {
        let engine = state
            .registry
            .get_or_init_engine(&state.db, &gwp.game)
            .await?;

        Game::set_undo_rejected(&state.db, game_id, true).await?;

        let gwp = Game::find_with_players(&state.db, game_id).await?;

        UndoResult {
            accepted: false,
            engine,
            gwp,
        }
    };

    // Notify both users with updated state
    let kind = if result.accepted {
        "undo_accepted"
    } else {
        "undo_rejected"
    };
    let tc = TimeControl::from_game(&result.gwp.game);
    let clock_data = if !tc.is_none() {
        state.registry.get_clock(game_id).await.map(|c| (c, tc))
    } else {
        None
    };
    let clock_ref = clock_data.as_ref().map(|(c, tc)| (c, tc));

    let online_ids = state.registry.get_online_user_ids(game_id).await;
    let online_users: Vec<UserData> = User::find_by_ids(&state.db, &online_ids)
        .await
        .unwrap_or_default()
        .iter()
        .map(UserData::from)
        .collect();
    let game_state = state_serializer::serialize_state(
        &result.gwp,
        &result.engine,
        false,
        None,
        None,
        clock_ref,
        &online_users,
    );
    for pid in [requesting_player_id, player_id] {
        state
            .registry
            .send_to_player(
                game_id,
                pid,
                &json!({
                    "kind": kind,
                    "game_id": game_id,
                    "state": game_state["state"],
                    "current_turn_stone": game_state["current_turn_stone"],
                    "moves": game_state["moves"],
                    "description": game_state["description"],
                    "undo_rejected": game_state["undo_rejected"],
                })
                .to_string(),
            )
            .await;
    }

    Ok(result)
}
