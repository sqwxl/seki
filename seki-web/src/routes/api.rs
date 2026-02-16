use argon2::password_hash::rand_core::OsRng;
use argon2::password_hash::SaltString;
use argon2::{Argon2, PasswordHash, PasswordHasher, PasswordVerifier};
use axum::extract::{Path, State};
use axum::routing::{get, post};
use axum::{Json, Router};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use tower_sessions::Session;

use crate::error::{ApiError, AppError};
use crate::models::game::Game;
use crate::models::message::Message;
use crate::models::player::Player;
use crate::models::turn::TurnRow;
use crate::services::{game_actions, game_creator, state_serializer};
use crate::session::{CurrentPlayer, PLAYER_ID_KEY};
use crate::AppState;

// -- Response types --

#[derive(Serialize)]
struct PlayerResponse {
    id: i64,
    username: String,
    is_registered: bool,
}

impl PlayerResponse {
    fn from_player(p: &Player) -> Self {
        Self {
            id: p.id,
            username: p.username.clone(),
            is_registered: p.is_registered(),
        }
    }
}

#[derive(Serialize)]
struct GameListItem {
    id: i64,
    cols: i32,
    rows: i32,
    komi: f64,
    handicap: i32,
    is_private: bool,
    is_handicap: bool,
    result: Option<String>,
    created_at: DateTime<Utc>,
    started_at: Option<DateTime<Utc>>,
    ended_at: Option<DateTime<Utc>>,
}

#[derive(Serialize)]
struct GameResponse {
    id: i64,
    cols: i32,
    rows: i32,
    komi: f64,
    handicap: i32,
    is_private: bool,
    is_handicap: bool,
    result: Option<String>,
    black: Option<PlayerResponse>,
    white: Option<PlayerResponse>,
    creator: Option<PlayerResponse>,
    created_at: DateTime<Utc>,
    started_at: Option<DateTime<Utc>>,
    ended_at: Option<DateTime<Utc>>,
    stage: String,
    state: serde_json::Value,
    current_turn_stone: i32,
    negotiations: serde_json::Value,
    territory: Option<serde_json::Value>,
}

#[derive(Serialize)]
struct TurnResponse {
    id: i64,
    turn_number: i32,
    kind: String,
    stone: i32,
    col: Option<i32>,
    row: Option<i32>,
    player_id: i64,
    created_at: DateTime<Utc>,
}

#[derive(Serialize)]
struct MessageResponse {
    id: i64,
    player_id: Option<i64>,
    sender: String,
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
    is_handicap: Option<bool>,
    allow_undo: Option<bool>,
    color: Option<String>,
    invite_email: Option<String>,
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
struct RegisterRequest {
    username: String,
    password: String,
    password_confirmation: String,
}

#[derive(Deserialize)]
struct LoginRequest {
    username: String,
    password: String,
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
        .route("/games/{id}/undo", post(request_undo))
        .route("/games/{id}/undo/respond", post(respond_to_undo))
        .route("/games/{id}/territory/toggle", post(toggle_chain))
        .route("/games/{id}/territory/approve", post(approve_territory))
        // Messages
        .route("/games/{id}/messages", get(get_messages).post(send_message))
        // Turns
        .route("/games/{id}/turns", get(get_turns))
        // Auth
        .route("/me", get(get_me))
        .route("/register", post(register))
        .route("/login", post(login))
        .route("/logout", post(logout))
}

// -- Game handlers --

async fn list_games(State(state): State<AppState>) -> Result<Json<Vec<GameListItem>>, ApiError> {
    let games = Game::list_public(&state.db).await?;
    let items: Vec<GameListItem> = games
        .into_iter()
        .map(|g| GameListItem {
            id: g.id,
            cols: g.cols,
            rows: g.rows,
            komi: g.komi,
            handicap: g.handicap,
            is_private: g.is_private,
            is_handicap: g.is_handicap,
            result: g.result,
            created_at: g.created_at,
            started_at: g.started_at,
            ended_at: g.ended_at,
        })
        .collect();
    Ok(Json(items))
}

async fn create_game(
    State(state): State<AppState>,
    current_player: CurrentPlayer,
    Json(body): Json<CreateGameRequest>,
) -> Result<Json<GameResponse>, ApiError> {
    let params = game_creator::CreateGameParams {
        cols: body.cols.unwrap_or(19),
        rows: body.rows.unwrap_or(19),
        komi: body.komi.unwrap_or(0.5),
        handicap: body.handicap.unwrap_or(0),
        is_private: body.is_private.unwrap_or(false),
        is_handicap: body.is_handicap.unwrap_or(false),
        allow_undo: body.allow_undo.unwrap_or(false),
        color: body.color.unwrap_or_else(|| "black".to_string()),
        invite_email: body.invite_email,
    };

    let game = game_creator::create_game(&state.db, &current_player, params).await?;
    let gwp = Game::find_with_players(&state.db, game.id).await?;
    let engine = state
        .registry
        .get_or_init_engine(&state.db, &gwp.game)
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;

    Ok(Json(build_game_response(&state, game.id, &gwp, &engine).await))
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
    current_player: CurrentPlayer,
    Path(id): Path<i64>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let game = Game::find_by_id(&state.db, id).await?;

    if game.creator_id != Some(current_player.id) {
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
    Ok(Json(serde_json::json!({"deleted": true})))
}

async fn join_game(
    State(state): State<AppState>,
    current_player: CurrentPlayer,
    Path(id): Path<i64>,
) -> Result<Json<GameResponse>, ApiError> {
    let gwp = Game::find_with_players(&state.db, id).await?;

    if gwp.has_player(current_player.id) {
        return Err(AppError::BadRequest("Already in this game".to_string()).into());
    }

    if gwp.game.black_id.is_none() {
        Game::set_black(&state.db, id, current_player.id).await?;
    } else if gwp.game.white_id.is_none() {
        Game::set_white(&state.db, id, current_player.id).await?;
    } else {
        return Err(AppError::BadRequest("Game is full".to_string()).into());
    }

    let gwp = Game::find_with_players(&state.db, id).await?;
    let engine = state
        .registry
        .get_or_init_engine(&state.db, &gwp.game)
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;

    Ok(Json(build_game_response(&state, id, &gwp, &engine).await))
}

// -- Game action handlers --

async fn play_move(
    State(state): State<AppState>,
    current_player: CurrentPlayer,
    Path(id): Path<i64>,
    Json(body): Json<PlayRequest>,
) -> Result<Json<GameResponse>, ApiError> {
    let engine = game_actions::play_move(&state, id, current_player.id, body.col, body.row).await?;
    let gwp = Game::find_with_players(&state.db, id).await?;
    Ok(Json(build_game_response(&state, id, &gwp, &engine).await))
}

async fn pass(
    State(state): State<AppState>,
    current_player: CurrentPlayer,
    Path(id): Path<i64>,
) -> Result<Json<GameResponse>, ApiError> {
    let engine = game_actions::pass(&state, id, current_player.id).await?;
    let gwp = Game::find_with_players(&state.db, id).await?;
    Ok(Json(build_game_response(&state, id, &gwp, &engine).await))
}

async fn resign(
    State(state): State<AppState>,
    current_player: CurrentPlayer,
    Path(id): Path<i64>,
) -> Result<Json<GameResponse>, ApiError> {
    let engine = game_actions::resign(&state, id, current_player.id).await?;
    let gwp = Game::find_with_players(&state.db, id).await?;
    Ok(Json(build_game_response(&state, id, &gwp, &engine).await))
}

async fn request_undo(
    State(state): State<AppState>,
    current_player: CurrentPlayer,
    Path(id): Path<i64>,
) -> Result<Json<serde_json::Value>, ApiError> {
    game_actions::request_undo(&state, id, current_player.id).await?;

    Ok(Json(serde_json::json!({
        "status": "undo_requested",
        "message": "Undo request sent. Waiting for opponent response."
    })))
}

async fn respond_to_undo(
    State(state): State<AppState>,
    current_player: CurrentPlayer,
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
        game_actions::respond_to_undo(&state, id, current_player.id, response == "accept").await?;

    Ok(Json(build_game_response(&state, id, &result.gwp, &result.engine).await))
}

async fn toggle_chain(
    State(state): State<AppState>,
    current_player: CurrentPlayer,
    Path(id): Path<i64>,
    Json(body): Json<ToggleChainRequest>,
) -> Result<Json<GameResponse>, ApiError> {
    game_actions::toggle_chain(&state, id, current_player.id, body.col, body.row).await?;
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
    current_player: CurrentPlayer,
    Path(id): Path<i64>,
) -> Result<Json<GameResponse>, ApiError> {
    game_actions::approve_territory(&state, id, current_player.id).await?;
    let gwp = Game::find_with_players(&state.db, id).await?;
    let engine = state
        .registry
        .get_or_init_engine(&state.db, &gwp.game)
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;
    Ok(Json(build_game_response(&state, id, &gwp, &engine).await))
}

// -- Message handlers --

async fn get_messages(
    State(state): State<AppState>,
    Path(id): Path<i64>,
) -> Result<Json<Vec<MessageResponse>>, ApiError> {
    // Verify game exists
    let gwp = Game::find_with_players(&state.db, id).await?;
    let messages = Message::find_by_game_id(&state.db, id).await?;

    let items: Vec<MessageResponse> = messages
        .into_iter()
        .map(|m| {
            let sender = match m.player_id {
                Some(pid) => {
                    let player =
                        if gwp.black.as_ref().is_some_and(|p| p.id == pid) {
                            gwp.black.as_ref()
                        } else if gwp.white.as_ref().is_some_and(|p| p.id == pid) {
                            gwp.white.as_ref()
                        } else {
                            None
                        };
                    let username = player.map(|p| p.username.as_str());
                    state_serializer::sender_label(&gwp, pid, username)
                }
                None => "\u{2691}".to_string(),
            };
            MessageResponse {
                id: m.id,
                player_id: m.player_id,
                sender,
                text: m.text,
                move_number: m.move_number,
                created_at: m.created_at,
            }
        })
        .collect();

    Ok(Json(items))
}

async fn send_message(
    State(state): State<AppState>,
    current_player: CurrentPlayer,
    Path(id): Path<i64>,
    Json(body): Json<ChatRequest>,
) -> Result<Json<MessageResponse>, ApiError> {
    let chat = game_actions::send_chat(&state, id, current_player.id, &body.text).await?;

    Ok(Json(MessageResponse {
        id: chat.message.id,
        player_id: chat.message.player_id,
        sender: chat.sender_label,
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
    // Verify game exists
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
            player_id: t.player_id,
            created_at: t.created_at,
        })
        .collect();

    Ok(Json(items))
}

// -- Auth handlers --

async fn get_me(current_player: CurrentPlayer) -> Json<PlayerResponse> {
    Json(PlayerResponse::from_player(&current_player))
}

async fn register(
    State(state): State<AppState>,
    current_player: CurrentPlayer,
    Json(body): Json<RegisterRequest>,
) -> Result<Json<PlayerResponse>, ApiError> {
    if current_player.is_registered() {
        return Err(AppError::BadRequest("Already registered".to_string()).into());
    }

    let username = body.username.trim().to_string();
    if username.is_empty() || username.len() > 30 {
        return Err(AppError::BadRequest(
            "Username must be between 1 and 30 characters".to_string(),
        )
        .into());
    }
    if body.password.len() < 8 {
        return Err(
            AppError::BadRequest("Password must be at least 8 characters".to_string()).into(),
        );
    }
    if body.password != body.password_confirmation {
        return Err(AppError::BadRequest("Passwords do not match".to_string()).into());
    }

    if Player::find_by_username(&state.db, &username)
        .await?
        .is_some()
    {
        return Err(AppError::BadRequest("Username is already taken".to_string()).into());
    }

    let salt = SaltString::generate(&mut OsRng);
    let password_hash = Argon2::default()
        .hash_password(body.password.as_bytes(), &salt)
        .map_err(|e| AppError::Internal(format!("Password hash error: {e}")))?
        .to_string();

    let player =
        Player::set_credentials(&state.db, current_player.id, &username, &password_hash).await?;

    Ok(Json(PlayerResponse::from_player(&player)))
}

async fn login(
    State(state): State<AppState>,
    session: Session,
    Json(body): Json<LoginRequest>,
) -> Result<Json<PlayerResponse>, ApiError> {
    let player = Player::find_by_username(&state.db, body.username.trim())
        .await?
        .ok_or_else(|| AppError::BadRequest("Invalid username or password".to_string()))?;

    let stored_hash = player
        .password_hash
        .as_ref()
        .ok_or_else(|| AppError::BadRequest("Invalid username or password".to_string()))?;

    let parsed_hash = PasswordHash::new(stored_hash)
        .map_err(|e| AppError::Internal(format!("Password hash parse error: {e}")))?;

    Argon2::default()
        .verify_password(body.password.as_bytes(), &parsed_hash)
        .map_err(|_| AppError::BadRequest("Invalid username or password".to_string()))?;

    let token = player
        .session_token
        .as_ref()
        .ok_or_else(|| AppError::Internal("Registered player has no session token".to_string()))?;
    session
        .insert(PLAYER_ID_KEY, token.clone())
        .await
        .map_err(|e| AppError::Internal(format!("Session insert error: {e}")))?;

    Ok(Json(PlayerResponse::from_player(&player)))
}

async fn logout(session: Session) -> Result<Json<serde_json::Value>, ApiError> {
    session
        .flush()
        .await
        .map_err(|e| AppError::Internal(format!("Session flush error: {e}")))?;
    Ok(Json(serde_json::json!({"logged_out": true})))
}

// -- Helpers --

async fn build_game_response(
    state: &AppState,
    game_id: i64,
    gwp: &crate::models::game::GameWithPlayers,
    engine: &go_engine::Engine,
) -> GameResponse {
    let territory = if engine.stage() == go_engine::Stage::TerritoryReview {
        state.registry.get_territory_review(game_id).await.map(|tr| {
            state_serializer::compute_territory_data(
                engine,
                &tr.dead_stones,
                gwp.game.komi,
                tr.black_approved,
                tr.white_approved,
            )
        })
    } else {
        None
    };

    let serialized =
        state_serializer::serialize_state(gwp, engine, false, territory.as_ref());

    let territory_json = serialized.get("territory").cloned();

    GameResponse {
        id: gwp.game.id,
        cols: gwp.game.cols,
        rows: gwp.game.rows,
        komi: gwp.game.komi,
        handicap: gwp.game.handicap,
        is_private: gwp.game.is_private,
        is_handicap: gwp.game.is_handicap,
        result: gwp.game.result.clone(),
        black: gwp.black.as_ref().map(PlayerResponse::from_player),
        white: gwp.white.as_ref().map(PlayerResponse::from_player),
        creator: gwp.creator.as_ref().map(PlayerResponse::from_player),
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
    }
}
