use axum::extract::{Path, State};
use axum::routing::{get, post};
use axum::{Json, Router};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use utoipa::openapi::security::{HttpAuthScheme, HttpBuilder, SecurityScheme};
use utoipa::{Modify, OpenApi, ToSchema};
use utoipa_scalar::{Scalar, Servable};

use crate::AppState;
use crate::error::{ApiError, ApiErrorResponse, AppError};
use crate::models::game::Game;
use crate::models::message::Message;
use crate::models::turn::TurnRow;
use crate::models::user::User;
use crate::services::live::build_live_items;
use crate::services::{game_actions, game_creator, game_joiner, state_serializer};
use crate::session::{ApiUser, OptionalApiUser};

// -- Response types --

#[derive(Serialize, ToSchema)]
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

#[derive(Serialize, ToSchema)]
struct GameResponse {
    id: i64,
    cols: i32,
    rows: i32,
    komi: f64,
    handicap: i32,
    /// Hidden from non-participants unless they have the access token.
    is_private: bool,
    /// Open seat may only be filled through the invite token.
    invite_only: bool,
    allow_undo: bool,
    result: Option<String>,
    black: Option<UserResponse>,
    white: Option<UserResponse>,
    creator: Option<UserResponse>,
    created_at: DateTime<Utc>,
    started_at: Option<DateTime<Utc>>,
    ended_at: Option<DateTime<Utc>>,
    stage: String,
    #[schema(value_type = Object)]
    state: serde_json::Value,
    current_turn_stone: i32,
    #[schema(value_type = Object)]
    negotiations: serde_json::Value,
    #[schema(value_type = Option<Object>)]
    territory: Option<serde_json::Value>,
    #[schema(value_type = Option<Object>)]
    clock: Option<serde_json::Value>,
}

#[derive(Serialize, ToSchema)]
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

#[derive(Serialize, ToSchema)]
struct MessageResponse {
    id: i64,
    user_id: Option<i64>,
    text: String,
    move_number: Option<i32>,
    created_at: DateTime<Utc>,
}

fn default_true() -> bool {
    true
}

// -- Request types --

#[derive(Deserialize, ToSchema)]
struct CreateGameRequest {
    cols: i32,
    #[serde(default)]
    rows: Option<i32>,
    komi: f64,
    handicap: i32,
    /// Hide the game from non-participants unless they have the access token.
    #[serde(default)]
    is_private: bool,
    #[serde(default = "default_true")]
    allow_undo: bool,
    color: String,
    /// Send an invite link by email. If the email matches an account, this becomes a direct challenge.
    #[serde(default)]
    invite_email: Option<String>,
    #[serde(default)]
    /// Assign the second seat immediately and create a direct challenge.
    invite_username: Option<String>,
    #[serde(default)]
    time_control: Option<crate::models::game::TimeControlType>,
    #[serde(default)]
    main_time_secs: Option<i32>,
    #[serde(default)]
    increment_secs: Option<i32>,
    #[serde(default)]
    byoyomi_time_secs: Option<i32>,
    #[serde(default)]
    byoyomi_periods: Option<i32>,
    #[serde(default)]
    open_to: Option<String>,
}

#[derive(Deserialize, ToSchema)]
struct GetGameQuery {
    access_token: Option<String>,
}

#[derive(Deserialize, ToSchema)]
struct PlayRequest {
    col: i32,
    row: i32,
    /// Client-measured thinking time in milliseconds (for lag compensation).
    client_move_time_ms: Option<i64>,
}

#[derive(Deserialize, ToSchema)]
struct PassRequest {
    /// Client-measured thinking time in milliseconds (for lag compensation).
    client_move_time_ms: Option<i64>,
}

#[derive(Deserialize, ToSchema)]
struct UndoResponseRequest {
    response: String,
}

#[derive(Deserialize, ToSchema)]
struct ToggleChainRequest {
    col: u8,
    row: u8,
}

#[derive(Deserialize, ToSchema)]
struct ChatRequest {
    text: String,
}

#[derive(Deserialize, ToSchema)]
struct RematchRequest {
    swap_colors: Option<bool>,
}

#[derive(Deserialize, ToSchema)]
struct JoinGameRequest {
    /// Private access token required to access private games through the API.
    access_token: Option<String>,
    /// Invite token required to fill an invite-only seat.
    invite_token: Option<String>,
}

// -- OpenAPI doc --

struct ApiModifier;

impl Modify for ApiModifier {
    fn modify(&self, openapi: &mut utoipa::openapi::OpenApi) {
        // Add bearer auth security scheme
        if let Some(components) = openapi.components.as_mut() {
            components.add_security_scheme(
                "bearer",
                SecurityScheme::Http(
                    HttpBuilder::new()
                        .scheme(HttpAuthScheme::Bearer)
                        .bearer_format("token")
                        .description(Some(
                            "API token from the /settings page. Pass as `Authorization: Bearer <token>`.",
                        ))
                        .build(),
                ),
            );
        }

        // Prefix all paths with /api (router is nested under /api in lib.rs)
        let old = std::mem::take(&mut openapi.paths.paths);
        openapi.paths.paths = old
            .into_iter()
            .map(|(path, item)| (format!("/api{path}"), item))
            .collect();
    }
}

#[derive(OpenApi)]
#[openapi(
    info(
        title = "Seki API",
        description = "API for the Seki Go game server. Errors use the envelope `{ \"error\": { \"code\": string, \"message\": string } }`.",
        version = "0.1.0"
    ),
    paths(
        list_games, create_game, get_game, delete_game, join_game,
        play_move, pass, resign, abort, request_undo, respond_to_undo,
        toggle_chain, approve_territory, accept_challenge, decline_challenge,
        rematch_game, get_messages, send_message, get_turns,
        get_user, get_user_games, get_me
    ),
    components(schemas(
        UserResponse, GameResponse, TurnResponse, MessageResponse,
        CreateGameRequest, PlayRequest, UndoResponseRequest, ToggleChainRequest,
        ChatRequest, RematchRequest, JoinGameRequest,
        crate::services::live::LiveGameItem,
        crate::services::live::GameSettings,
        crate::models::game::TimeControlType,
        crate::templates::UserData,
        crate::error::ApiErrorResponse,
        crate::error::ApiErrorDetail
    )),
    modifiers(&ApiModifier),
    tags(
        (name = "Games", description = "Game CRUD and joining"),
        (name = "Game Actions", description = "In-game moves, pass, resign, undo, territory"),
        (name = "Messages", description = "In-game chat"),
        (name = "Turns", description = "Move history"),
        (name = "Users", description = "User profiles and game history"),
        (name = "Auth", description = "Current user info")
    )
)]
pub struct ApiDoc;

const SCALAR_HTML: &str = r#"<!doctype html>
<html>
<head>
  <title>Seki API</title>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
</head>
<body>
  <script id="api-reference" data-configuration='{"agent":{"disabled":true}}' type="application/json">$spec</script>
  <script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"></script>
</body>
</html>"#;

// -- Router --

pub fn router() -> Router<AppState> {
    let spec = ApiDoc::openapi();

    Router::new()
        .route(
            "/openapi.json",
            get({
                let spec = spec.clone();
                move || async move { Json(spec) }
            }),
        )
        .merge(Scalar::with_url("/docs", spec).custom_html(SCALAR_HTML))
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

#[utoipa::path(
    get,
    path = "/games",
    tag = "Games",
    responses(
        (status = 200, description = "List of public games", body = Vec<crate::services::live::LiveGameItem>)
    )
)]
async fn list_games(
    State(state): State<AppState>,
) -> Result<Json<Vec<crate::services::live::LiveGameItem>>, ApiError> {
    let games = Game::list_public_with_players(&state.db, None).await?;
    let items = build_live_items(&state.db, &games).await;
    Ok(Json(items))
}

#[utoipa::path(
    post,
    path = "/games",
    tag = "Games",
    security(("bearer" = [])),
    request_body = CreateGameRequest,
    responses(
        (status = 201, description = "Created game", body = GameResponse),
        (status = 401, description = "Unauthorized", body = ApiErrorResponse),
        (status = 422, description = "Validation error", body = ApiErrorResponse),
        (status = 500, description = "Internal server error", body = ApiErrorResponse)
    )
)]
async fn create_game(
    State(state): State<AppState>,
    api_user: ApiUser,
    Json(body): Json<CreateGameRequest>,
) -> Result<(axum::http::StatusCode, Json<GameResponse>), ApiError> {
    let invite_email = body.invite_email.clone();
    let params = game_creator::CreateGameParams {
        cols: body.cols,
        rows: body.rows.unwrap_or(body.cols),
        komi: body.komi,
        handicap: body.handicap,
        is_private: body.is_private,
        allow_undo: body.allow_undo,
        color: body.color,
        invite_email: body.invite_email,
        invite_username: body.invite_username,
        time_control: body.time_control.unwrap_or_default(),
        main_time_secs: body.main_time_secs,
        increment_secs: body.increment_secs,
        byoyomi_time_secs: body.byoyomi_time_secs,
        byoyomi_periods: body.byoyomi_periods,
        open_to: body.open_to,
    };

    let game = game_creator::create_game(&state.db, &api_user, params).await?;
    let gwp = Game::find_with_players(&state.db, game.id).await?;
    crate::services::live::notify_game_created(&state, &gwp);
    if let (Some(email), Some(token)) = (&invite_email, &game.invite_token) {
        let mailer = state.mailer.clone();
        let email = email.clone();
        let token = token.clone();
        let base_url = std::env::var("BASE_URL").unwrap_or_else(|_| "http://localhost:3000".into());
        let game_id = game.id;
        tokio::spawn(async move {
            mailer
                .send_invitation(&email, game_id, &token, &base_url)
                .await;
        });
    }
    let engine = state
        .registry
        .get_or_init_engine(&state.db, &gwp.game)
        .await?;

    Ok((
        axum::http::StatusCode::CREATED,
        Json(build_game_response(&state, game.id, &gwp, &engine).await),
    ))
}

#[utoipa::path(
    get,
    path = "/games/{id}",
    tag = "Games",
    security((), ("bearer" = [])),
    params(("id" = i64, Path, description = "Game ID")),
    responses(
        (status = 200, description = "Game details", body = GameResponse),
        (status = 404, description = "Game not found", body = ApiErrorResponse),
        (status = 500, description = "Internal server error", body = ApiErrorResponse)
    )
)]
async fn get_game(
    State(state): State<AppState>,
    OptionalApiUser(api_user): OptionalApiUser,
    axum::extract::Query(query): axum::extract::Query<GetGameQuery>,
    Path(id): Path<i64>,
) -> Result<Json<GameResponse>, ApiError> {
    let gwp = Game::find_with_players(&state.db, id).await?;

    // Private game access check
    if gwp.game.is_private {
        let user_id = api_user.as_ref().map(|u| u.id);
        let has_valid_access_token = gwp
            .game
            .access_token
            .as_deref()
            .zip(query.access_token.as_deref())
            .is_some_and(|(game_tok, query_tok)| game_tok == query_tok);
        if !user_id.is_some_and(|uid| gwp.has_player(uid)) && !has_valid_access_token {
            return Err(AppError::NotFound("Game not found".to_string()).into());
        }
    }

    let engine = state
        .registry
        .get_or_init_engine(&state.db, &gwp.game)
        .await?;

    Ok(Json(build_game_response(&state, id, &gwp, &engine).await))
}

#[utoipa::path(
    delete,
    path = "/games/{id}",
    tag = "Games",
    security(("bearer" = [])),
    params(("id" = i64, Path, description = "Game ID")),
    responses(
        (status = 200, description = "Game deleted", body = Object),
        (status = 401, description = "Unauthorized", body = ApiErrorResponse),
        (status = 404, description = "Game not found", body = ApiErrorResponse),
        (status = 422, description = "Validation error", body = ApiErrorResponse),
        (status = 500, description = "Internal server error", body = ApiErrorResponse)
    )
)]
async fn delete_game(
    State(state): State<AppState>,
    api_user: ApiUser,
    Path(id): Path<i64>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let game = Game::find_by_id(&state.db, id).await?;

    if game.creator_id != Some(api_user.id) {
        return Err(AppError::UnprocessableEntity(
            "Only the creator can delete this game".to_string(),
        )
        .into());
    }
    if game.started_at.is_some() {
        return Err(AppError::UnprocessableEntity(
            "Cannot delete a game that has started".to_string(),
        )
        .into());
    }

    Game::delete(&state.db, id).await?;
    crate::services::live::notify_game_removed(&state, id);
    Ok(Json(serde_json::json!({"deleted": true})))
}

#[utoipa::path(
    post,
    path = "/games/{id}/join",
    tag = "Games",
    security(("bearer" = [])),
    params(("id" = i64, Path, description = "Game ID")),
    request_body = JoinGameRequest,
    responses(
        (status = 200, description = "Joined game", body = GameResponse),
        (status = 400, description = "Already joined or game full"),
        (status = 401, description = "Unauthorized")
    )
)]
async fn join_game(
    State(state): State<AppState>,
    api_user: ApiUser,
    Path(id): Path<i64>,
    Json(body): Json<JoinGameRequest>,
) -> Result<Json<GameResponse>, ApiError> {
    let gwp = Game::find_with_players(&state.db, id).await?;

    // Cannot join finished or aborted games
    if gwp.game.result.is_some() {
        return Err(AppError::UnprocessableEntity(
            "Cannot join a finished or aborted game".to_string(),
        )
        .into());
    }

    if gwp.has_player(api_user.id) {
        return Err(AppError::UnprocessableEntity("Already in this game".to_string()).into());
    }

    // Enforce open_to restriction
    if gwp.game.open_to.as_deref() == Some("registered") && !api_user.is_registered() {
        return Err(AppError::UnprocessableEntity(
            "This game is restricted to registered users".to_string(),
        )
        .into());
    }

    let has_valid_access_token = gwp
        .game
        .access_token
        .as_deref()
        .zip(body.access_token.as_deref())
        .is_some_and(|(game_tok, query_tok)| game_tok == query_tok);
    let has_valid_invite_token = gwp
        .game
        .invite_token
        .as_deref()
        .zip(body.invite_token.as_deref())
        .is_some_and(|(game_tok, query_tok)| game_tok == query_tok);

    if gwp.game.requires_access_token_to_join() && !has_valid_access_token {
        return Err(AppError::UnprocessableEntity(
            "This game requires a valid access token to join".to_string(),
        )
        .into());
    }

    if gwp.game.requires_invite_token_to_join() && !has_valid_invite_token {
        return Err(AppError::UnprocessableEntity(
            "This game requires a valid invite token to join".to_string(),
        )
        .into());
    }

    game_joiner::join_open_game(&state.db, &gwp, &api_user).await?;

    let gwp = Game::find_with_players(&state.db, id).await?;
    let engine = state
        .registry
        .get_or_init_engine(&state.db, &gwp.game)
        .await?;

    crate::services::live::notify_game_created(&state, &gwp);

    Ok(Json(build_game_response(&state, id, &gwp, &engine).await))
}

// -- Game action handlers --

#[utoipa::path(
    post,
    path = "/games/{id}/play",
    tag = "Game Actions",
    security(("bearer" = [])),
    params(("id" = i64, Path, description = "Game ID")),
    request_body = PlayRequest,
    responses(
        (status = 200, description = "Move played", body = GameResponse),
        (status = 400, description = "Illegal move"),
        (status = 401, description = "Unauthorized")
    )
)]
async fn play_move(
    State(state): State<AppState>,
    api_user: ApiUser,
    Path(id): Path<i64>,
    Json(body): Json<PlayRequest>,
) -> Result<Json<GameResponse>, ApiError> {
    let engine = game_actions::play_move(
        &state,
        id,
        api_user.id,
        body.col,
        body.row,
        body.client_move_time_ms,
    )
    .await?;
    let gwp = Game::find_with_players(&state.db, id).await?;
    Ok(Json(build_game_response(&state, id, &gwp, &engine).await))
}

#[utoipa::path(
    post,
    path = "/games/{id}/pass",
    tag = "Game Actions",
    security(("bearer" = [])),
    params(("id" = i64, Path, description = "Game ID")),
    request_body(content = Option<PassRequest>, description = "Optional timing data"),
    responses(
        (status = 200, description = "Passed", body = GameResponse),
        (status = 400, description = "Cannot pass"),
        (status = 401, description = "Unauthorized")
    )
)]
async fn pass(
    State(state): State<AppState>,
    api_user: ApiUser,
    Path(id): Path<i64>,
    body: Option<Json<PassRequest>>,
) -> Result<Json<GameResponse>, ApiError> {
    let client_move_time_ms = body.and_then(|b| b.client_move_time_ms);
    let engine = game_actions::pass(&state, id, api_user.id, client_move_time_ms).await?;
    let gwp = Game::find_with_players(&state.db, id).await?;
    Ok(Json(build_game_response(&state, id, &gwp, &engine).await))
}

#[utoipa::path(
    post,
    path = "/games/{id}/resign",
    tag = "Game Actions",
    security(("bearer" = [])),
    params(("id" = i64, Path, description = "Game ID")),
    responses(
        (status = 200, description = "Resigned", body = GameResponse),
        (status = 400, description = "Cannot resign"),
        (status = 401, description = "Unauthorized")
    )
)]
async fn resign(
    State(state): State<AppState>,
    api_user: ApiUser,
    Path(id): Path<i64>,
) -> Result<Json<GameResponse>, ApiError> {
    let engine = game_actions::resign(&state, id, api_user.id).await?;
    let gwp = Game::find_with_players(&state.db, id).await?;
    Ok(Json(build_game_response(&state, id, &gwp, &engine).await))
}

#[utoipa::path(
    post,
    path = "/games/{id}/abort",
    tag = "Game Actions",
    security(("bearer" = [])),
    params(("id" = i64, Path, description = "Game ID")),
    responses(
        (status = 200, description = "Aborted", body = Object),
        (status = 400, description = "Cannot abort"),
        (status = 401, description = "Unauthorized")
    )
)]
async fn abort(
    State(state): State<AppState>,
    api_user: ApiUser,
    Path(id): Path<i64>,
) -> Result<Json<serde_json::Value>, ApiError> {
    game_actions::abort(&state, id, api_user.id).await?;
    Ok(Json(serde_json::json!({ "status": "aborted" })))
}

#[utoipa::path(
    post,
    path = "/games/{id}/accept",
    tag = "Game Actions",
    security(("bearer" = [])),
    params(("id" = i64, Path, description = "Game ID")),
    responses(
        (status = 200, description = "Challenge accepted", body = Object),
        (status = 400, description = "Cannot accept"),
        (status = 401, description = "Unauthorized")
    )
)]
async fn accept_challenge(
    State(state): State<AppState>,
    api_user: ApiUser,
    Path(id): Path<i64>,
) -> Result<Json<serde_json::Value>, ApiError> {
    game_actions::accept_challenge(&state, id, api_user.id).await?;
    Ok(Json(serde_json::json!({ "status": "accepted" })))
}

#[utoipa::path(
    post,
    path = "/games/{id}/decline",
    tag = "Game Actions",
    security(("bearer" = [])),
    params(("id" = i64, Path, description = "Game ID")),
    responses(
        (status = 200, description = "Challenge declined", body = Object),
        (status = 400, description = "Cannot decline"),
        (status = 401, description = "Unauthorized")
    )
)]
async fn decline_challenge(
    State(state): State<AppState>,
    api_user: ApiUser,
    Path(id): Path<i64>,
) -> Result<Json<serde_json::Value>, ApiError> {
    game_actions::decline_challenge(&state, id, api_user.id).await?;
    Ok(Json(serde_json::json!({ "status": "declined" })))
}

#[utoipa::path(
    post,
    path = "/games/{id}/undo",
    tag = "Game Actions",
    security(("bearer" = [])),
    params(("id" = i64, Path, description = "Game ID")),
    responses(
        (status = 200, description = "Undo requested", body = Object),
        (status = 400, description = "Cannot request undo"),
        (status = 401, description = "Unauthorized")
    )
)]
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

#[utoipa::path(
    post,
    path = "/games/{id}/undo/respond",
    tag = "Game Actions",
    security(("bearer" = [])),
    params(("id" = i64, Path, description = "Game ID")),
    request_body = UndoResponseRequest,
    responses(
        (status = 200, description = "Undo response processed", body = GameResponse),
        (status = 400, description = "Invalid response"),
        (status = 401, description = "Unauthorized")
    )
)]
async fn respond_to_undo(
    State(state): State<AppState>,
    api_user: ApiUser,
    Path(id): Path<i64>,
    Json(body): Json<UndoResponseRequest>,
) -> Result<Json<GameResponse>, ApiError> {
    let response = body.response.trim().to_lowercase();
    if response != "accept" && response != "reject" {
        return Err(AppError::UnprocessableEntity(
            "Invalid response. Must be 'accept' or 'reject'".to_string(),
        )
        .into());
    }

    game_actions::respond_to_undo(&state, id, api_user.id, response == "accept").await?;

    let gwp = Game::find_with_players(&state.db, id).await?;
    let engine = state
        .registry
        .get_or_init_engine(&state.db, &gwp.game)
        .await?;
    Ok(Json(build_game_response(&state, id, &gwp, &engine).await))
}

#[utoipa::path(
    post,
    path = "/games/{id}/territory/toggle",
    tag = "Game Actions",
    security(("bearer" = [])),
    params(("id" = i64, Path, description = "Game ID")),
    request_body = ToggleChainRequest,
    responses(
        (status = 200, description = "Chain toggled", body = GameResponse),
        (status = 400, description = "Cannot toggle"),
        (status = 401, description = "Unauthorized")
    )
)]
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
        .await?;
    Ok(Json(build_game_response(&state, id, &gwp, &engine).await))
}

#[utoipa::path(
    post,
    path = "/games/{id}/territory/approve",
    tag = "Game Actions",
    security(("bearer" = [])),
    params(("id" = i64, Path, description = "Game ID")),
    responses(
        (status = 200, description = "Territory approved", body = GameResponse),
        (status = 400, description = "Cannot approve"),
        (status = 401, description = "Unauthorized")
    )
)]
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
        .await?;
    Ok(Json(build_game_response(&state, id, &gwp, &engine).await))
}

#[utoipa::path(
    post,
    path = "/games/{id}/rematch",
    tag = "Game Actions",
    security(("bearer" = [])),
    params(("id" = i64, Path, description = "Game ID")),
    request_body = RematchRequest,
    responses(
        (status = 200, description = "Rematch created", body = GameResponse),
        (status = 400, description = "Cannot rematch"),
        (status = 401, description = "Unauthorized")
    )
)]
async fn rematch_game(
    State(state): State<AppState>,
    api_user: ApiUser,
    Path(id): Path<i64>,
    Json(body): Json<RematchRequest>,
) -> Result<Json<GameResponse>, ApiError> {
    let gwp = Game::find_with_players(&state.db, id).await?;

    if gwp.game.result.is_none() {
        return Err(AppError::UnprocessableEntity("Game is not finished".to_string()).into());
    }
    if !gwp.has_player(api_user.id) {
        return Err(
            AppError::UnprocessableEntity("You are not a player in this game".to_string()).into(),
        );
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
        open_to: None,
    };

    let game = game_creator::create_game(&state.db, &api_user, params).await?;

    if let Some(opp_id) = opponent_id {
        let mut tx = state.db.begin().await?;
        if game.black_id.is_none() {
            Game::set_black(&mut *tx, game.id, opp_id).await?;
        } else if game.white_id.is_none() {
            Game::set_white(&mut *tx, game.id, opp_id).await?;
        }
        if game.stage == "unstarted" {
            Game::set_stage(&mut *tx, game.id, "challenge").await?;
        }
        tx.commit().await?;
    }

    let gwp = Game::find_with_players(&state.db, game.id).await?;
    crate::services::live::notify_game_created(&state, &gwp);

    let engine = state
        .registry
        .get_or_init_engine(&state.db, &gwp.game)
        .await?;

    Ok(Json(
        build_game_response(&state, game.id, &gwp, &engine).await,
    ))
}

// -- Message handlers --

#[utoipa::path(
    get,
    path = "/games/{id}/messages",
    tag = "Messages",
    params(("id" = i64, Path, description = "Game ID")),
    responses(
        (status = 200, description = "List of messages", body = Vec<MessageResponse>),
        (status = 404, description = "Game not found")
    )
)]
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

#[utoipa::path(
    post,
    path = "/games/{id}/messages",
    tag = "Messages",
    security(("bearer" = [])),
    params(("id" = i64, Path, description = "Game ID")),
    request_body = ChatRequest,
    responses(
        (status = 200, description = "Message sent", body = MessageResponse),
        (status = 401, description = "Unauthorized"),
        (status = 404, description = "Game not found")
    )
)]
async fn send_message(
    State(state): State<AppState>,
    api_user: ApiUser,
    Path(id): Path<i64>,
    Json(body): Json<ChatRequest>,
) -> Result<Json<MessageResponse>, ApiError> {
    let chat = game_actions::send_chat(&state, id, api_user.id, &body.text, None).await?;

    Ok(Json(MessageResponse {
        id: chat.message.id,
        user_id: chat.message.user_id,
        text: chat.message.text,
        move_number: chat.message.move_number,
        created_at: chat.message.created_at,
    }))
}

// -- Turn handlers --

#[utoipa::path(
    get,
    path = "/games/{id}/turns",
    tag = "Turns",
    params(("id" = i64, Path, description = "Game ID")),
    responses(
        (status = 200, description = "List of turns", body = Vec<TurnResponse>),
        (status = 404, description = "Game not found")
    )
)]
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

#[utoipa::path(
    get,
    path = "/users/{username}",
    tag = "Users",
    params(("username" = String, Path, description = "Username")),
    responses(
        (status = 200, description = "User profile", body = UserResponse),
        (status = 404, description = "User not found")
    )
)]
async fn get_user(
    State(state): State<AppState>,
    Path(username): Path<String>,
) -> Result<Json<UserResponse>, ApiError> {
    let user = User::find_by_username(&state.db, &username)
        .await?
        .ok_or_else(|| AppError::NotFound("User not found".to_string()))?;
    Ok(Json(UserResponse::from_user(&user)))
}

#[utoipa::path(
    get,
    path = "/users/{username}/games",
    tag = "Users",
    params(("username" = String, Path, description = "Username")),
    responses(
        (status = 200, description = "User's games", body = Vec<crate::services::live::LiveGameItem>),
        (status = 404, description = "User not found")
    )
)]
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

#[utoipa::path(
    get,
    path = "/me",
    tag = "Auth",
    security(("bearer" = [])),
    responses(
        (status = 200, description = "Current authenticated user", body = UserResponse),
        (status = 401, description = "Unauthorized", body = ApiErrorResponse)
    )
)]
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
        invite_only: gwp.game.invite_only,
        allow_undo: gwp.game.allow_undo,
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
