use axum::extract::{Path, State};
use axum::routing::{get, post};
use axum::{Json, Router};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use crate::AppState;
use crate::error::{ApiError, AppError};
use crate::models::game::Game;
use crate::models::message::Message;
use crate::models::turn::TurnRow;
use crate::models::user::User;
use crate::services::live::build_live_items;
use crate::services::{game_actions, game_creator, state_serializer};
use crate::session::ApiUser;

// -- Response types --

#[derive(Serialize)]
struct UserResponse {
    id: i64,
    username: String,
    is_registered: bool,
}

impl UserResponse {
    fn from_user(p: &User) -> Self {
        Self {
            id: p.id,
            username: p.username.clone(),
            is_registered: p.is_registered(),
        }
    }
}

#[derive(Serialize)]
struct GameResponse {
    id: i64,
    cols: i32,
    rows: i32,
    komi: f64,
    handicap: i32,
    is_private: bool,
    result: Option<String>,
    black: Option<UserResponse>,
    white: Option<UserResponse>,
    creator: Option<UserResponse>,
    created_at: DateTime<Utc>,
    started_at: Option<DateTime<Utc>>,
    ended_at: Option<DateTime<Utc>>,
    stage: String,
    state: serde_json::Value,
    current_turn_stone: i32,
    negotiations: serde_json::Value,
    territory: Option<serde_json::Value>,
    clock: Option<serde_json::Value>,
}

#[derive(Serialize)]
struct TurnResponse {
    id: i64,
    turn_number: i32,
    kind: String,
    stone: i32,
    col: Option<i32>,
    row: Option<i32>,
    user_id: i64,
    created_at: DateTime<Utc>,
}

#[derive(Serialize)]
struct MessageResponse {
    id: i64,
    user_id: Option<i64>,
    text: String,
    move_number: Option<i32>,
    created_at: DateTime<Utc>,
}

// -- Request types --

#[derive(Deserialize)]
struct CreateGameRequest {
    cols: Option<i32>,
    rows: Option<i32>,
    komi: Option<f64>,
    handicap: Option<i32>,
    is_private: Option<bool>,
    allow_undo: Option<bool>,
    color: Option<String>,
    invite_email: Option<String>,
    time_control: Option<crate::models::game::TimeControlType>,
    main_time_secs: Option<i32>,
    increment_secs: Option<i32>,
    byoyomi_time_secs: Option<i32>,
    byoyomi_periods: Option<i32>,
}

#[derive(Deserialize)]
struct PlayRequest {
    col: i32,
    row: i32,
}

#[derive(Deserialize)]
struct UndoResponseRequest {
    response: String,
}

#[derive(Deserialize)]
struct ToggleChainRequest {
    col: u8,
    row: u8,
}

#[derive(Deserialize)]
struct ChatRequest {
    text: String,
}

#[derive(Deserialize)]
struct RematchRequest {
    swap_colors: Option<bool>,
}

// -- Router --

pub fn router() -> Router<AppState> {
    Router::new()
        // Games
        .route("/games", get(list_games).post(create_game))
        .route("/games/{id}", get(get_game).delete(delete_game))
        .route("/games/{id}/join", post(join_game))
        // Game actions
        .route("/games/{id}/play", post(play_move))
        .route("/games/{id}/pass", post(pass))
        .route("/games/{id}/resign", post(resign))
        .route("/games/{id}/abort", post(abort))
        .route("/games/{id}/undo", post(request_undo))
        .route("/games/{id}/undo/respond", post(respond_to_undo))
        .route("/games/{id}/territory/toggle", post(toggle_chain))
        .route("/games/{id}/territory/approve", post(approve_territory))
        .route("/games/{id}/accept", post(accept_challenge))
        .route("/games/{id}/decline", post(decline_challenge))
        .route("/games/{id}/rematch", post(rematch_game))
        // Messages
        .route("/games/{id}/messages", get(get_messages).post(send_message))
        // Turns
        .route("/games/{id}/turns", get(get_turns))
        // Users
        .route("/users/{username}", get(get_user))
        .route("/users/{username}/games", get(get_user_games))
        // Auth
        .route("/me", get(get_me))
}

// -- Game handlers --

async fn list_games(
    State(state): State<AppState>,
) -> Result<Json<Vec<crate::services::live::LiveGameItem>>, ApiError> {
    let games = Game::list_public_with_players(&state.db, None).await?;
    let items = build_live_items(&state.db, &games).await;
    Ok(Json(items))
}

async fn create_game(
    State(state): State<AppState>,
    api_user: ApiUser,
    Json(body): Json<CreateGameRequest>,
) -> Result<Json<GameResponse>, ApiError> {
    let params = game_creator::CreateGameParams {
        cols: body.cols.unwrap_or(19),
        rows: body.rows.unwrap_or(19),
        komi: body.komi.unwrap_or(0.5),
        handicap: body.handicap.unwrap_or(0),
        is_private: body.is_private.unwrap_or(false),
        allow_undo: body.allow_undo.unwrap_or(false),
        color: body.color.unwrap_or_else(|| "black".to_string()),
        invite_email: body.invite_email,
        invite_username: None,
        time_control: body.time_control.unwrap_or_default(),
        main_time_secs: body.main_time_secs,
        increment_secs: body.increment_secs,
        byoyomi_time_secs: body.byoyomi_time_secs,
        byoyomi_periods: body.byoyomi_periods,
    };

    let game = game_creator::create_game(&state.db, &api_user, params).await?;
    crate::services::live::notify_game_created(&state, game.id).await;
    let gwp = Game::find_with_players(&state.db, game.id).await?;
    let engine = state
        .registry
        .get_or_init_engine(&state.db, &gwp.game)
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;

    Ok(Json(
        build_game_response(&state, game.id, &gwp, &engine).await,
    ))
}

async fn get_game(
    State(state): State<AppState>,
    Path(id): Path<i64>,
) -> Result<Json<GameResponse>, ApiError> {
    let gwp = Game::find_with_players(&state.db, id).await?;
    let engine = state
        .registry
        .get_or_init_engine(&state.db, &gwp.game)
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;

    Ok(Json(build_game_response(&state, id, &gwp, &engine).await))
}

async fn delete_game(
    State(state): State<AppState>,
    api_user: ApiUser,
    Path(id): Path<i64>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let game = Game::find_by_id(&state.db, id).await?;

    if game.creator_id != Some(api_user.id) {
        return Err(
            AppError::BadRequest("Only the creator can delete this game".to_string()).into(),
        );
    }
    if game.started_at.is_some() {
        return Err(
            AppError::BadRequest("Cannot delete a game that has started".to_string()).into(),
        );
    }

    Game::delete(&state.db, id).await?;
    crate::services::live::notify_game_removed(&state, id);
    Ok(Json(serde_json::json!({"deleted": true})))
}

async fn join_game(
    State(state): State<AppState>,
    api_user: ApiUser,
    Path(id): Path<i64>,
) -> Result<Json<GameResponse>, ApiError> {
    let gwp = Game::find_with_players(&state.db, id).await?;

    if gwp.has_player(api_user.id) {
        return Err(AppError::BadRequest("Already in this game".to_string()).into());
    }

    let mut tx = state
        .db
        .begin()
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;
    if gwp.game.black_id.is_none() {
        Game::set_black(&mut *tx, id, api_user.id).await?;
    } else if gwp.game.white_id.is_none() {
        Game::set_white(&mut *tx, id, api_user.id).await?;
    } else {
        return Err(AppError::BadRequest("Game is full".to_string()).into());
    }
    let started = gwp.game.stage == "unstarted";
    let start_stage = if gwp.game.handicap >= 2 {
        "white_to_play"
    } else {
        "black_to_play"
    };
    if started {
        Game::set_stage(&mut *tx, id, start_stage).await?;
    }
    tx.commit()
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;

    let gwp = Game::find_with_players(&state.db, id).await?;
    let engine = state
        .registry
        .get_or_init_engine(&state.db, &gwp.game)
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;

    crate::services::live::notify_game_created(&state, id).await;

    Ok(Json(build_game_response(&state, id, &gwp, &engine).await))
}

// -- Game action handlers --

async fn play_move(
    State(state): State<AppState>,
    api_user: ApiUser,
    Path(id): Path<i64>,
    Json(body): Json<PlayRequest>,
) -> Result<Json<GameResponse>, ApiError> {
    let engine = game_actions::play_move(&state, id, api_user.id, body.col, body.row).await?;
    let gwp = Game::find_with_players(&state.db, id).await?;
    Ok(Json(build_game_response(&state, id, &gwp, &engine).await))
}

async fn pass(
    State(state): State<AppState>,
    api_user: ApiUser,
    Path(id): Path<i64>,
) -> Result<Json<GameResponse>, ApiError> {
    let engine = game_actions::pass(&state, id, api_user.id).await?;
    let gwp = Game::find_with_players(&state.db, id).await?;
    Ok(Json(build_game_response(&state, id, &gwp, &engine).await))
}

async fn resign(
    State(state): State<AppState>,
    api_user: ApiUser,
    Path(id): Path<i64>,
) -> Result<Json<GameResponse>, ApiError> {
    let engine = game_actions::resign(&state, id, api_user.id).await?;
    let gwp = Game::find_with_players(&state.db, id).await?;
    Ok(Json(build_game_response(&state, id, &gwp, &engine).await))
}

async fn abort(
    State(state): State<AppState>,
    api_user: ApiUser,
    Path(id): Path<i64>,
) -> Result<Json<serde_json::Value>, ApiError> {
    game_actions::abort(&state, id, api_user.id).await?;
    Ok(Json(serde_json::json!({ "status": "aborted" })))
}

async fn accept_challenge(
    State(state): State<AppState>,
    api_user: ApiUser,
    Path(id): Path<i64>,
) -> Result<Json<serde_json::Value>, ApiError> {
    game_actions::accept_challenge(&state, id, api_user.id).await?;
    Ok(Json(serde_json::json!({ "status": "accepted" })))
}

async fn decline_challenge(
    State(state): State<AppState>,
    api_user: ApiUser,
    Path(id): Path<i64>,
) -> Result<Json<serde_json::Value>, ApiError> {
    game_actions::decline_challenge(&state, id, api_user.id).await?;
    Ok(Json(serde_json::json!({ "status": "declined" })))
}

async fn request_undo(
    State(state): State<AppState>,
    api_user: ApiUser,
    Path(id): Path<i64>,
) -> Result<Json<serde_json::Value>, ApiError> {
    game_actions::request_undo(&state, id, api_user.id).await?;

    Ok(Json(serde_json::json!({
        "status": "undo_requested",
        "message": "Undo request sent. Waiting for opponent response."
    })))
}

async fn respond_to_undo(
    State(state): State<AppState>,
    api_user: ApiUser,
    Path(id): Path<i64>,
    Json(body): Json<UndoResponseRequest>,
) -> Result<Json<GameResponse>, ApiError> {
    let response = body.response.trim().to_lowercase();
    if response != "accept" && response != "reject" {
        return Err(AppError::BadRequest(
            "Invalid response. Must be 'accept' or 'reject'".to_string(),
        )
        .into());
    }

    let result =
        game_actions::respond_to_undo(&state, id, api_user.id, response == "accept").await?;

    Ok(Json(
        build_game_response(&state, id, &result.gwp, &result.engine).await,
    ))
}

async fn toggle_chain(
    State(state): State<AppState>,
    api_user: ApiUser,
    Path(id): Path<i64>,
    Json(body): Json<ToggleChainRequest>,
) -> Result<Json<GameResponse>, ApiError> {
    game_actions::toggle_chain(&state, id, api_user.id, body.col, body.row).await?;
    let gwp = Game::find_with_players(&state.db, id).await?;
    let engine = state
        .registry
        .get_or_init_engine(&state.db, &gwp.game)
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;
    Ok(Json(build_game_response(&state, id, &gwp, &engine).await))
}

async fn approve_territory(
    State(state): State<AppState>,
    api_user: ApiUser,
    Path(id): Path<i64>,
) -> Result<Json<GameResponse>, ApiError> {
    game_actions::approve_territory(&state, id, api_user.id).await?;
    let gwp = Game::find_with_players(&state.db, id).await?;
    let engine = state
        .registry
        .get_or_init_engine(&state.db, &gwp.game)
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;
    Ok(Json(build_game_response(&state, id, &gwp, &engine).await))
}

async fn rematch_game(
    State(state): State<AppState>,
    api_user: ApiUser,
    Path(id): Path<i64>,
    Json(body): Json<RematchRequest>,
) -> Result<Json<GameResponse>, ApiError> {
    let gwp = Game::find_with_players(&state.db, id).await?;

    if gwp.game.result.is_none() {
        return Err(AppError::BadRequest("Game is not finished".to_string()).into());
    }
    if !gwp.has_player(api_user.id) {
        return Err(AppError::BadRequest("You are not a player in this game".to_string()).into());
    }

    let swap = body.swap_colors.unwrap_or(false);
    let was_black = gwp.game.black_id == Some(api_user.id);
    let color = match (was_black, swap) {
        (true, false) | (false, true) => "black",
        (true, true) | (false, false) => "white",
    };

    let opponent_id = if was_black {
        gwp.game.white_id
    } else {
        gwp.game.black_id
    };

    let params = game_creator::CreateGameParams {
        cols: gwp.game.cols,
        rows: gwp.game.rows,
        komi: gwp.game.komi,
        handicap: gwp.game.handicap,
        is_private: gwp.game.is_private,
        allow_undo: gwp.game.allow_undo,
        color: color.to_string(),
        invite_email: None,
        invite_username: None,
        time_control: gwp.game.time_control,
        main_time_secs: gwp.game.main_time_secs,
        increment_secs: gwp.game.increment_secs,
        byoyomi_time_secs: gwp.game.byoyomi_time_secs,
        byoyomi_periods: gwp.game.byoyomi_periods,
    };

    let game = game_creator::create_game(&state.db, &api_user, params).await?;

    if let Some(opp_id) = opponent_id {
        let mut tx = state
            .db
            .begin()
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;
        if game.black_id.is_none() {
            Game::set_black(&mut *tx, game.id, opp_id).await?;
        } else if game.white_id.is_none() {
            Game::set_white(&mut *tx, game.id, opp_id).await?;
        }
        if game.stage == "unstarted" {
            Game::set_stage(&mut *tx, game.id, "challenge").await?;
        }
        tx.commit()
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;
    }

    crate::services::live::notify_game_created(&state, game.id).await;

    let gwp = Game::find_with_players(&state.db, game.id).await?;
    let engine = state
        .registry
        .get_or_init_engine(&state.db, &gwp.game)
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;

    Ok(Json(
        build_game_response(&state, game.id, &gwp, &engine).await,
    ))
}

// -- Message handlers --

async fn get_messages(
    State(state): State<AppState>,
    Path(id): Path<i64>,
) -> Result<Json<Vec<MessageResponse>>, ApiError> {
    Game::find_by_id(&state.db, id).await?;
    let messages = Message::find_by_game_id(&state.db, id).await?;

    let items: Vec<MessageResponse> = messages
        .into_iter()
        .map(|m| MessageResponse {
            id: m.id,
            user_id: m.user_id,
            text: m.text,
            move_number: m.move_number,
            created_at: m.created_at,
        })
        .collect();

    Ok(Json(items))
}

async fn send_message(
    State(state): State<AppState>,
    api_user: ApiUser,
    Path(id): Path<i64>,
    Json(body): Json<ChatRequest>,
) -> Result<Json<MessageResponse>, ApiError> {
    let chat = game_actions::send_chat(&state, id, api_user.id, &body.text).await?;

    Ok(Json(MessageResponse {
        id: chat.message.id,
        user_id: chat.message.user_id,
        text: chat.message.text,
        move_number: chat.message.move_number,
        created_at: chat.message.created_at,
    }))
}

// -- Turn handlers --

async fn get_turns(
    State(state): State<AppState>,
    Path(id): Path<i64>,
) -> Result<Json<Vec<TurnResponse>>, ApiError> {
    Game::find_by_id(&state.db, id).await?;
    let turns = TurnRow::find_by_game_id(&state.db, id).await?;

    let items: Vec<TurnResponse> = turns
        .into_iter()
        .map(|t| TurnResponse {
            id: t.id,
            turn_number: t.turn_number,
            kind: t.kind,
            stone: t.stone,
            col: t.col,
            row: t.row,
            user_id: t.user_id,
            created_at: t.created_at,
        })
        .collect();

    Ok(Json(items))
}

// -- User handlers --

async fn get_user(
    State(state): State<AppState>,
    Path(username): Path<String>,
) -> Result<Json<UserResponse>, ApiError> {
    let user = User::find_by_username(&state.db, &username)
        .await?
        .ok_or_else(|| AppError::NotFound("User not found".to_string()))?;
    Ok(Json(UserResponse::from_user(&user)))
}

async fn get_user_games(
    State(state): State<AppState>,
    Path(username): Path<String>,
) -> Result<Json<Vec<crate::services::live::LiveGameItem>>, ApiError> {
    let user = User::find_by_username(&state.db, &username)
        .await?
        .ok_or_else(|| AppError::NotFound("User not found".to_string()))?;
    let games = Game::list_all_for_player(&state.db, user.id).await?;
    let items = build_live_items(&state.db, &games).await;
    Ok(Json(items))
}

// -- Auth handlers --

async fn get_me(api_user: ApiUser) -> Json<UserResponse> {
    Json(UserResponse::from_user(&api_user))
}

// -- Helpers --

async fn build_game_response(
    state: &AppState,
    game_id: i64,
    gwp: &crate::models::game::GameWithPlayers,
    engine: &go_engine::Engine,
) -> GameResponse {
    let game_is_done = gwp.game.result.is_some();
    let territory = if !game_is_done && engine.stage() == go_engine::Stage::TerritoryReview {
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

    let tc = crate::services::clock::TimeControl::from_game(&gwp.game);
    let clock_data = if !tc.is_none() {
        state.registry.get_clock(game_id).await.map(|c| (c, tc))
    } else {
        None
    };
    let clock_ref = clock_data.as_ref().map(|(c, tc)| (c, tc));

    let settled_territory = if gwp.game.result.is_some() && territory.is_none() {
        crate::models::game::Game::load_settled_territory(&state.db, game_id)
            .await
            .ok()
            .flatten()
            .map(|raw| state_serializer::build_settled_territory(engine, gwp.game.komi, raw))
    } else {
        None
    };

    let serialized = state_serializer::serialize_state(
        gwp,
        engine,
        false,
        territory.as_ref(),
        settled_territory.as_ref(),
        clock_ref,
        &[] as &[crate::templates::UserData],
    );

    let territory_json = serialized.get("territory").cloned();
    let clock_json = serialized.get("clock").cloned();

    GameResponse {
        id: gwp.game.id,
        cols: gwp.game.cols,
        rows: gwp.game.rows,
        komi: gwp.game.komi,
        handicap: gwp.game.handicap,
        is_private: gwp.game.is_private,
        result: gwp.game.result.clone(),
        black: gwp.black.as_ref().map(UserResponse::from_user),
        white: gwp.white.as_ref().map(UserResponse::from_user),
        creator: gwp.creator.as_ref().map(UserResponse::from_user),
        created_at: gwp.game.created_at,
        started_at: gwp.game.started_at,
        ended_at: gwp.game.ended_at,
        stage: serialized["stage"]
            .as_str()
            .unwrap_or("unknown")
            .to_string(),
        state: serialized["state"].clone(),
        current_turn_stone: serialized["current_turn_stone"].as_i64().unwrap_or(1) as i32,
        negotiations: serialized["negotiations"].clone(),
        territory: territory_json,
        clock: clock_json,
    }
}
