use chrono::Utc;
use go_engine::{Engine, Stage, Stone};
use serde_json::json;

use crate::AppState;
use crate::error::AppError;
use crate::models::game::{Game, GameWithPlayers};
use crate::models::message::Message;
use crate::models::turn::TurnRow;
use crate::services::clock::{self, ClockState, TimeControl};
use crate::services::{engine_builder, live, state_serializer};

// -- Return types --

pub struct ChatSent {
    pub message: Message,
}

pub struct UndoResult {
    pub accepted: bool,
    pub engine: Engine,
    pub gwp: GameWithPlayers,
}

// -- Core game actions --
// Each action performs business logic, persists state, and broadcasts to WS clients.
// Callers (API routes, WS handlers) only need to build their own response format.

pub async fn play_move(
    state: &AppState,
    game_id: i64,
    player_id: i64,
    col: i32,
    row: i32,
) -> Result<Engine, AppError> {
    if col < 0 || row < 0 {
        return Err(AppError::BadRequest("Invalid coordinates".to_string()));
    }

    let gwp = load_game_and_check_player(state, game_id, player_id).await?;
    require_both_players(&gwp)?;
    let stone = player_stone(&gwp, player_id)?;

    let engine = apply_engine_mutation(state, game_id, &gwp.game, |engine| {
        engine.try_play(stone, (col as u8, row as u8)).map(|_| ())
    })
    .await?;

    // Persist all DB writes in a transaction
    let mut tx = state
        .db
        .begin()
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;

    let move_number = (engine.moves().len() - 1) as i32;
    if let Err(e) = TurnRow::create(
        &mut *tx,
        game_id,
        player_id,
        move_number,
        "play",
        stone.to_int() as i32,
        Some(col),
        Some(row),
    )
    .await
    {
        rollback_engine(state, game_id, &gwp.game).await;
        return Err(AppError::Internal(e.to_string()));
    }

    let first_move = gwp.game.started_at.is_none();
    if first_move {
        Game::set_started(&mut *tx, game_id)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;
    }

    process_clock_after_move(state, &mut *tx, game_id, &gwp.game, stone, first_move).await?;
    persist_stage(&mut *tx, game_id, &engine).await?;

    if gwp.game.undo_rejected {
        Game::set_undo_rejected(&mut *tx, game_id, false)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;
    }

    tx.commit()
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;

    // Non-transactional post-actions
    state.registry.set_undo_requested(game_id, false).await;
    broadcast_game_state(state, &gwp, &engine).await;

    Ok(engine)
}

pub async fn pass(state: &AppState, game_id: i64, player_id: i64) -> Result<Engine, AppError> {
    let gwp = load_game_and_check_player(state, game_id, player_id).await?;
    require_both_players(&gwp)?;
    let stone = player_stone(&gwp, player_id)?;

    let engine = apply_engine_mutation(state, game_id, &gwp.game, |engine| {
        engine.try_pass(stone).map(|_| ())
    })
    .await?;

    // Persist all DB writes in a transaction
    let mut tx = state
        .db
        .begin()
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;

    let move_number = (engine.moves().len() - 1) as i32;
    if let Err(e) = TurnRow::create(
        &mut *tx,
        game_id,
        player_id,
        move_number,
        "pass",
        stone.to_int() as i32,
        None,
        None,
    )
    .await
    {
        rollback_engine(state, game_id, &gwp.game).await;
        return Err(AppError::Internal(e.to_string()));
    }

    process_clock_after_move(state, &mut *tx, game_id, &gwp.game, stone, false).await?;
    persist_stage(&mut *tx, game_id, &engine).await?;

    if gwp.game.undo_rejected {
        Game::set_undo_rejected(&mut *tx, game_id, false)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;
    }

    // Pause clock if entering territory review
    if engine.stage() == Stage::TerritoryReview {
        pause_clock(state, &mut *tx, game_id, &gwp.game).await?;
    }

    tx.commit()
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;

    // Non-transactional post-actions
    state.registry.set_undo_requested(game_id, false).await;

    if engine.stage() == Stage::TerritoryReview {
        let dead_stones = go_engine::territory::detect_dead_stones(engine.goban());
        state
            .registry
            .init_territory_review(game_id, dead_stones)
            .await;
        broadcast_system_chat(state, game_id, "Territory review has begun", Some(engine.moves().len() as i32)).await;
    }

    broadcast_game_state(state, &gwp, &engine).await;

    Ok(engine)
}

pub async fn toggle_chain(
    state: &AppState,
    game_id: i64,
    player_id: i64,
    col: u8,
    row: u8,
) -> Result<(), AppError> {
    let gwp = load_game_and_check_player(state, game_id, player_id).await?;
    require_both_players(&gwp)?;

    let engine = state
        .registry
        .get_or_init_engine(&state.db, &gwp.game)
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;

    if engine.stage() != Stage::TerritoryReview {
        return Err(AppError::BadRequest("Not in territory review".to_string()));
    }

    state
        .registry
        .toggle_dead_chain(game_id, (col, row), engine.goban())
        .await
        .ok_or_else(|| AppError::Internal("Territory review state not found".to_string()))?;

    let _ = Game::clear_territory_review_deadline(&state.db, game_id).await;

    // Re-fetch so broadcast sees the cleared deadline
    let gwp = Game::find_with_players(&state.db, game_id)
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;
    broadcast_game_state(state, &gwp, &engine).await;
    Ok(())
}

pub async fn approve_territory(
    state: &AppState,
    game_id: i64,
    player_id: i64,
) -> Result<(), AppError> {
    let gwp = load_game_and_check_player(state, game_id, player_id).await?;
    require_both_players(&gwp)?;
    let stone = player_stone(&gwp, player_id)?;

    let engine = state
        .registry
        .get_or_init_engine(&state.db, &gwp.game)
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;

    if engine.stage() != Stage::TerritoryReview {
        return Err(AppError::BadRequest("Not in territory review".to_string()));
    }

    state.registry.set_approved(game_id, stone, true).await;

    let tr = state
        .registry
        .get_territory_review(game_id)
        .await
        .ok_or_else(|| AppError::Internal("Territory review state not found".to_string()))?;

    if tr.black_approved && tr.white_approved {
        Game::clear_territory_review_deadline(&state.db, game_id)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;
        settle_territory(state, game_id, &gwp, &engine, &tr.dead_stones).await?;
    } else if tr.black_approved || tr.white_approved {
        let deadline = Utc::now() + chrono::Duration::seconds(60);
        Game::set_territory_review_deadline(&state.db, game_id, deadline)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;
        // Re-fetch so broadcast sees the new deadline
        let gwp = Game::find_with_players(&state.db, game_id)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;
        broadcast_game_state(state, &gwp, &engine).await;
    } else {
        broadcast_game_state(state, &gwp, &engine).await;
    }

    Ok(())
}

pub async fn settle_territory(
    state: &AppState,
    game_id: i64,
    gwp: &GameWithPlayers,
    engine: &Engine,
    dead_stones: &std::collections::HashSet<go_engine::Point>,
) -> Result<(), AppError> {
    let ownership = go_engine::territory::estimate_territory(engine.goban(), dead_stones);
    let gs = go_engine::territory::score(engine.goban(), &ownership, dead_stones, gwp.game.komi);
    let result = gs.result();

    let dead_json: Vec<serde_json::Value> = dead_stones
        .iter()
        .map(|&(c, r)| serde_json::json!([c, r]))
        .collect();
    let dead_json_str =
        serde_json::to_string(&dead_json).map_err(|e| AppError::Internal(e.to_string()))?;

    // Persist all DB writes in a transaction
    let mut tx = state
        .db
        .begin()
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;

    pause_clock(state, &mut *tx, game_id, &gwp.game).await?;

    Game::clear_territory_review_deadline(&mut *tx, game_id)
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;

    sqlx::query(
        "INSERT INTO territory_reviews \
         (game_id, settled, dead_stones, black_territory, black_captures, white_territory, white_captures) \
         VALUES ($1, TRUE, $2::jsonb, $3, $4, $5, $6)",
    )
    .bind(game_id)
    .bind(&dead_json_str)
    .bind(gs.black.territory as i32)
    .bind(gs.black.captures as i32)
    .bind(gs.white.territory as i32)
    .bind(gs.white.captures as i32)
    .execute(&mut *tx)
    .await
    .map_err(|e| AppError::Internal(e.to_string()))?;

    Game::set_ended(&mut *tx, game_id, &result)
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;

    tx.commit()
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;

    // Non-transactional post-actions
    state
        .registry
        .with_engine_mut(game_id, |engine| {
            engine.set_result(result.clone());
            Ok(())
        })
        .await;

    let engine = state
        .registry
        .get_engine(game_id)
        .await
        .ok_or_else(|| AppError::Internal("Engine cache unavailable".to_string()))?;

    state.registry.clear_territory_review(game_id).await;

    broadcast_system_chat(state, game_id, &format!("Game over. {result}"), Some(engine.moves().len() as i32)).await;
    broadcast_game_state(state, gwp, &engine).await;

    Ok(())
}

pub async fn resign(state: &AppState, game_id: i64, player_id: i64) -> Result<Engine, AppError> {
    let gwp = load_game_and_check_player(state, game_id, player_id).await?;
    require_both_players(&gwp)?;

    if gwp.game.result.is_some() {
        return Err(AppError::BadRequest("The game is over".to_string()));
    }

    let stone = player_stone(&gwp, player_id)?;

    let engine = apply_engine_mutation(state, game_id, &gwp.game, |engine| {
        engine.try_resign(stone);
        Ok(())
    })
    .await?;

    if engine.stage() == Stage::Done {
        let mut tx = state
            .db
            .begin()
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;

        pause_clock(state, &mut *tx, game_id, &gwp.game).await?;

        let move_number = engine.moves().len() as i32;
        if let Err(e) = TurnRow::create(
            &mut *tx,
            game_id,
            player_id,
            move_number,
            "resign",
            stone.to_int() as i32,
            None,
            None,
        )
        .await
        {
            rollback_engine(state, game_id, &gwp.game).await;
            return Err(AppError::Internal(e.to_string()));
        }

        if let Some(result) = engine.result() {
            Game::set_ended(&mut *tx, game_id, result)
                .await
                .map_err(|e| {
                    // tx will rollback on drop
                    AppError::Internal(e.to_string())
                })?;
        }

        tx.commit()
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;
    }

    broadcast_game_state(state, &gwp, &engine).await;

    Ok(engine)
}

pub async fn abort(state: &AppState, game_id: i64, player_id: i64) -> Result<(), AppError> {
    let gwp = load_game_and_check_player(state, game_id, player_id).await?;

    if gwp.game.result.is_some() {
        return Err(AppError::BadRequest("The game is over".to_string()));
    }

    if gwp.game.started_at.is_some() {
        return Err(AppError::BadRequest(
            "Cannot abort after the first move".to_string(),
        ));
    }

    // Persist all DB writes in a transaction
    let mut tx = state
        .db
        .begin()
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;
    pause_clock(state, &mut *tx, game_id, &gwp.game).await?;
    Game::set_ended(&mut *tx, game_id, "Aborted")
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;
    tx.commit()
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;

    live::notify_game_removed(state, game_id);

    // Update engine cache
    let _ = state
        .registry
        .with_engine_mut(game_id, |engine| {
            engine.set_result("Aborted".to_string());
            Ok(())
        })
        .await;

    broadcast_system_chat(state, game_id, "Game aborted", None).await;

    if let Some(engine) = state.registry.get_engine(game_id).await {
        broadcast_game_state(state, &gwp, &engine).await;
    }

    Ok(())
}

pub async fn send_chat(
    state: &AppState,
    game_id: i64,
    player_id: i64,
    text: &str,
) -> Result<ChatSent, AppError> {
    let text = text.trim();
    if text.is_empty() {
        return Err(AppError::BadRequest("Message cannot be empty".to_string()));
    }
    if text.len() > 1000 {
        return Err(AppError::BadRequest(
            "Message too long (max 1000 characters)".to_string(),
        ));
    }

    let game = Game::find_by_id(&state.db, game_id)
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;

    let move_number = current_move_number(state, &game).await;

    let msg = Message::create(&state.db, game_id, Some(player_id), text, move_number)
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;

    state
        .registry
        .broadcast(
            game_id,
            &json!({
                "kind": "chat",
                "game_id": game_id,
                "player_id": player_id,
                "text": msg.text,
                "move_number": msg.move_number,
                "sent_at": msg.created_at
            })
            .to_string(),
        )
        .await;

    Ok(ChatSent { message: msg })
}

pub async fn request_undo(state: &AppState, game_id: i64, player_id: i64) -> Result<(), AppError> {
    let gwp = load_game_and_check_player(state, game_id, player_id).await?;

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

    let last_turn = TurnRow::last_turn(&state.db, game_id)
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;
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
    let move_number = current_move_number(state, &gwp.game).await;

    // System chat
    broadcast_system_chat(
        state,
        game_id,
        &format!("{requesting_name} requested to undo their last move"),
        move_number,
    )
    .await;

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
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;
    let requesting_player_id = gwp
        .out_of_turn_player(engine.current_turn_stone())
        .map(|p| p.id)
        .ok_or_else(|| AppError::Internal("Cannot determine requesting user".to_string()))?;

    if requesting_player_id == player_id {
        return Err(AppError::BadRequest(
            "Cannot respond to your own undo request".to_string(),
        ));
    }

    let responding_name = gwp
        .player_by_id(player_id)
        .map(|u| u.display_name().to_string())
        .unwrap_or_else(|| "Unknown".to_string());

    // Clear the in-memory request flag regardless of accept/reject
    state.registry.set_undo_requested(game_id, false).await;

    let result = if accept {
        // Delete turn + rebuild engine + set stage atomically
        let mut tx = state
            .db
            .begin()
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;

        TurnRow::delete_last(&mut *tx, game_id)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;

        // Rebuild engine within the transaction so reads see the deleted turn
        let game = Game::find_by_id(&mut *tx, game_id)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;
        let db_turns = TurnRow::find_by_game_id(&mut *tx, game_id)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;
        let turns = engine_builder::convert_turns(&db_turns);
        let engine = Engine::with_handicap_and_moves(game.cols as u8, game.rows as u8, game.handicap as u8, turns);

        persist_stage(&mut *tx, game_id, &engine).await?;
        engine_builder::cache_engine_state(&mut *tx, game_id, &engine, db_turns.len() as i64, None)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;

        tx.commit()
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;

        state.registry.replace_engine(game_id, engine.clone()).await;

        let gwp = Game::find_with_players(&state.db, game_id)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;

        UndoResult {
            accepted: true,
            engine,
            gwp,
        }
    } else {
        let engine = state
            .registry
            .get_or_init_engine(&state.db, &gwp.game)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;

        Game::set_undo_rejected(&state.db, game_id, true)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;

        let gwp = Game::find_with_players(&state.db, game_id)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;

        UndoResult {
            accepted: false,
            engine,
            gwp,
        }
    };

    // System chat
    let message = if result.accepted {
        format!("{responding_name} accepted the undo request. Move has been undone.")
    } else {
        format!("{responding_name} rejected the undo request")
    };
    broadcast_system_chat(state, game_id, &message, Some(result.engine.moves().len() as i32)).await;

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

    let online_users = state.registry.get_online_user_ids(game_id).await;
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

// -- Internal helpers --

async fn broadcast_game_state(state: &AppState, gwp: &GameWithPlayers, engine: &Engine) {
    let game_id = gwp.game.id;
    let undo_requested = state.registry.is_undo_requested(game_id).await;

    let territory = if engine.stage() == Stage::TerritoryReview {
        state
            .registry
            .get_territory_review(game_id)
            .await
            .map(|tr| {
                state_serializer::compute_territory_data(
                    engine,
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

    let tc = TimeControl::from_game(&gwp.game);
    let clock_data = if !tc.is_none() {
        state.registry.get_clock(game_id).await.map(|c| (c, tc))
    } else {
        None
    };
    let clock_ref = clock_data.as_ref().map(|(c, tc)| (c, tc));

    let online_users = state.registry.get_online_user_ids(game_id).await;
    let game_state = state_serializer::serialize_state(
        gwp,
        engine,
        undo_requested,
        territory.as_ref(),
        None,
        clock_ref,
        &online_users,
    );

    state
        .registry
        .broadcast(game_id, &game_state.to_string())
        .await;

    // Notify live subscribers (games list, etc.)
    live::notify_game_updated(state, gwp, Some(engine.moves().len()));
}

async fn broadcast_system_chat(
    state: &AppState,
    game_id: i64,
    text: &str,
    move_number: Option<i32>,
) {
    let saved = Message::create_system(&state.db, game_id, text, move_number)
        .await
        .ok();
    let sent_at = saved.as_ref().map(|m| m.created_at);

    state
        .registry
        .broadcast(
            game_id,
            &json!({
                "kind": "chat",
                "game_id": game_id,
                "text": text,
                "move_number": move_number,
                "sent_at": sent_at
            })
            .to_string(),
        )
        .await;
}

async fn load_game_and_check_player(
    state: &AppState,
    game_id: i64,
    player_id: i64,
) -> Result<GameWithPlayers, AppError> {
    let gwp = Game::find_with_players(&state.db, game_id)
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;

    if !gwp.has_player(player_id) {
        return Err(AppError::BadRequest(
            "Only players can perform this action".to_string(),
        ));
    }

    Ok(gwp)
}

fn require_both_players(gwp: &GameWithPlayers) -> Result<(), AppError> {
    if gwp.is_open() {
        return Err(AppError::BadRequest(
            "Waiting for opponent to join".to_string(),
        ));
    }
    Ok(())
}

fn player_stone(gwp: &GameWithPlayers, player_id: i64) -> Result<Stone, AppError> {
    Stone::from_int(gwp.player_stone(player_id) as i8)
        .ok_or_else(|| AppError::BadRequest("You are not a user in this game".to_string()))
}

async fn apply_engine_mutation<F>(
    state: &AppState,
    game_id: i64,
    game: &Game,
    f: F,
) -> Result<Engine, AppError>
where
    F: FnOnce(&mut Engine) -> Result<(), go_engine::GoError>,
{
    state
        .registry
        .get_or_init_engine(&state.db, game)
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;

    match state.registry.with_engine_mut(game_id, f).await {
        Some(Ok(engine)) => Ok(engine),
        Some(Err(e)) => Err(AppError::BadRequest(e.to_string())),
        None => Err(AppError::Internal("Engine cache unavailable".to_string())),
    }
}

async fn persist_stage(
    executor: impl sqlx::PgExecutor<'_>,
    game_id: i64,
    engine: &Engine,
) -> Result<(), AppError> {
    Game::set_stage(executor, game_id, &engine.stage().to_string())
        .await
        .map_err(|e| AppError::Internal(e.to_string()))
}

async fn rollback_engine(state: &AppState, game_id: i64, game: &Game) {
    if let Ok(rebuilt) = engine_builder::build_engine(&state.db, game).await {
        state.registry.replace_engine(game_id, rebuilt).await;
    }
}

async fn current_move_number(state: &AppState, game: &Game) -> Option<i32> {
    state
        .registry
        .get_or_init_engine(&state.db, game)
        .await
        .ok()
        .map(|e| e.moves().len() as i32)
}

// -- Clock helpers --

/// Process clock after a play or pass move.
async fn process_clock_after_move(
    state: &AppState,
    executor: impl sqlx::PgExecutor<'_>,
    game_id: i64,
    game: &Game,
    stone: Stone,
    first_move: bool,
) -> Result<(), AppError> {
    let tc = TimeControl::from_game(game);
    if tc.is_none() {
        return Ok(());
    }

    let mut clock = load_or_init_clock(state, game_id, game).await?;
    let now = Utc::now();
    let active = clock::active_stone_from_stage(&game.stage);

    if first_move {
        clock.start(now);
    } else {
        clock.process_move(stone, active, &tc, now);
    }

    // After the move, the new active stone is the opponent
    let new_active = Some(stone.opp());
    persist_clock(state, executor, game_id, &clock, &tc, new_active).await?;

    Ok(())
}

/// Pause the clock (territory review, game end).
async fn pause_clock(
    state: &AppState,
    executor: impl sqlx::PgExecutor<'_>,
    game_id: i64,
    game: &Game,
) -> Result<(), AppError> {
    let tc = TimeControl::from_game(game);
    if tc.is_none() {
        return Ok(());
    }

    if let Some(mut clock) = state.registry.get_clock(game_id).await {
        let active = clock::active_stone_from_stage(&game.stage);
        clock.pause(active, Utc::now());
        persist_clock(state, executor, game_id, &clock, &tc, None).await?;
    }

    Ok(())
}

/// Load clock from registry cache, falling back to the game row.
async fn load_or_init_clock(
    state: &AppState,
    game_id: i64,
    game: &Game,
) -> Result<ClockState, AppError> {
    if let Some(clock) = state.registry.get_clock(game_id).await {
        return Ok(clock);
    }

    let clock = ClockState::from_game(game)
        .ok_or_else(|| AppError::Internal("Clock not found for timed game".to_string()))?;

    state.registry.update_clock(game_id, clock.clone()).await;
    Ok(clock)
}

/// Persist clock state to both registry and DB (games table).
/// `active_stone` is the user whose clock should be ticking (None if paused).
async fn persist_clock(
    state: &AppState,
    executor: impl sqlx::PgExecutor<'_>,
    game_id: i64,
    clock: &ClockState,
    tc: &TimeControl,
    active_stone: Option<Stone>,
) -> Result<(), AppError> {
    state.registry.update_clock(game_id, clock.clone()).await;

    Game::update_clock(executor, game_id, &clock.to_update(active_stone, tc))
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;

    Ok(())
}

/// Handle a client-initiated timeout flag. Validates the clock truly expired before ending the game.
pub async fn handle_timeout_flag(
    state: &AppState,
    game_id: i64,
    _player_id: i64,
) -> Result<(), AppError> {
    let now = Utc::now();

    let gwp = Game::find_with_players(&state.db, game_id)
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;

    if gwp.game.result.is_some() {
        return Ok(());
    }

    let tc = TimeControl::from_game(&gwp.game);
    if tc.is_none() {
        return Ok(());
    }

    let clock = load_or_init_clock(state, game_id, &gwp.game).await?;

    let Some(active) = clock::active_stone_from_stage(&gwp.game.stage) else {
        return Ok(());
    };

    if !clock.is_flagged(active, Some(active), &tc, now) {
        return Ok(());
    }

    end_game_on_time(state, &gwp, active, clock, &tc, now).await
}

/// Handle a client-initiated territory review timeout flag.
/// Validates the deadline truly expired before settling the game.
pub async fn handle_territory_timeout_flag(
    state: &AppState,
    game_id: i64,
    _player_id: i64,
) -> Result<(), AppError> {
    let gwp = Game::find_with_players(&state.db, game_id)
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;

    if gwp.game.result.is_some() {
        return Ok(());
    }

    let deadline = match gwp.game.territory_review_expires_at {
        Some(d) => d,
        None => return Ok(()),
    };

    if Utc::now() < deadline {
        return Ok(());
    }

    let engine = state
        .registry
        .get_or_init_engine(&state.db, &gwp.game)
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;

    if engine.stage() != Stage::TerritoryReview {
        return Ok(());
    }

    let tr = state
        .registry
        .get_territory_review(game_id)
        .await
        .ok_or_else(|| AppError::Internal("Territory review state not found".to_string()))?;

    settle_territory(state, game_id, &gwp, &engine, &tr.dead_stones).await
}

/// End a game due to time expiration. Used by both client flag and server sweep.
pub async fn end_game_on_time(
    state: &AppState,
    gwp: &GameWithPlayers,
    flagged_stone: Stone,
    mut clock: ClockState,
    tc: &TimeControl,
    now: chrono::DateTime<chrono::Utc>,
) -> Result<(), AppError> {
    let game_id = gwp.game.id;
    let winner = flagged_stone.opp();
    let result = match winner {
        Stone::Black => "B+T",
        Stone::White => "W+T",
    };

    clock.pause(Some(flagged_stone), now);

    // Persist all DB writes in a transaction
    let mut tx = state
        .db
        .begin()
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;
    Game::set_ended(&mut *tx, game_id, result)
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;
    persist_clock(state, &mut *tx, game_id, &clock, tc, None).await?;
    tx.commit()
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;

    // Non-transactional post-actions
    let _ = state
        .registry
        .with_engine_mut(game_id, |engine| {
            engine.set_result(result.to_string());
            Ok(())
        })
        .await;

    let engine = state.registry.get_engine(game_id).await;
    let move_number = engine.as_ref().map(|e| e.moves().len() as i32);
    broadcast_system_chat(state, game_id, &format!("Game over. {result}"), move_number).await;

    if let Some(engine) = engine {
        broadcast_game_state(state, gwp, &engine).await;
    }

    live::notify_game_removed(state, game_id);

    Ok(())
}
