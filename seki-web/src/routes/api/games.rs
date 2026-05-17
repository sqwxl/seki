use axum::Json;
use axum::extract::{Path, Query, State};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::AppState;
use crate::error::{ApiError, ApiErrorResponse, AppError};
use crate::models::game::Game;
use crate::services::live::build_live_items;
use crate::services::{game_creator, game_joiner};
use crate::session::{ApiUser, OptionalApiUser};

use super::users::UserResponse;

fn default_true() -> bool {
    true
}

#[derive(Serialize, ToSchema)]
pub(crate) struct GameResponse {
    pub(crate) id: i64,
    pub(crate) cols: i32,
    pub(crate) rows: i32,
    pub(crate) komi: f64,
    pub(crate) handicap: i32,
    /// Hidden from non-participants unless they have the access token.
    pub(crate) is_private: bool,
    /// Open seat may only be filled through the invite token.
    pub(crate) invite_only: bool,
    pub(crate) allow_undo: bool,
    pub(crate) result: Option<String>,
    pub(crate) black: Option<UserResponse>,
    pub(crate) white: Option<UserResponse>,
    pub(crate) creator: Option<UserResponse>,
    pub(crate) created_at: DateTime<Utc>,
    pub(crate) started_at: Option<DateTime<Utc>>,
    pub(crate) ended_at: Option<DateTime<Utc>>,
    pub(crate) stage: String,
    #[schema(value_type = Object)]
    pub(crate) state: serde_json::Value,
    pub(crate) current_turn_stone: i32,
    #[schema(value_type = Object)]
    pub(crate) negotiations: serde_json::Value,
    #[schema(value_type = Option<Object>)]
    pub(crate) territory: Option<serde_json::Value>,
    #[schema(value_type = Option<Object>)]
    pub(crate) clock: Option<serde_json::Value>,
}

#[derive(Deserialize, ToSchema)]
pub(crate) struct CreateGameRequest {
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
    #[serde(default)]
    ranked: bool,
}

#[derive(Deserialize, ToSchema)]
pub(crate) struct GetGameQuery {
    pub(crate) access_token: Option<String>,
    pub(crate) invite_token: Option<String>,
}

#[derive(Deserialize, ToSchema)]
pub(crate) struct JoinGameRequest {
    /// Private access token required to access private games through the API.
    access_token: Option<String>,
    /// Invite token required to fill an invite-only seat.
    invite_token: Option<String>,
}

#[utoipa::path(
    get,
    path = "/games",
    tag = "Games",
    responses(
        (status = 200, description = "List of public games", body = Vec<crate::services::live::LiveGameItem>)
    )
)]
pub(super) async fn list_games(
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
pub(super) async fn create_game(
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
        ranked: body.ranked,
        max_handicap: None,
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
        Json(super::users::build_game_response(&state, game.id, &gwp, &engine).await),
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
pub(super) async fn get_game(
    State(state): State<AppState>,
    OptionalApiUser(api_user): OptionalApiUser,
    Query(query): Query<GetGameQuery>,
    Path(id): Path<i64>,
) -> Result<Json<GameResponse>, ApiError> {
    let gwp = Game::find_with_players(&state.db, id).await?;

    if !crate::services::game_access::can_view_game(
        &gwp,
        api_user.as_ref().map(|u| u.id),
        crate::services::game_access::GameViewTokens {
            access_token: query.access_token.as_deref(),
            invite_token: query.invite_token.as_deref(),
        },
    ) {
        return Err(AppError::NotFound("Game not found".to_string()).into());
    }

    let engine = state
        .registry
        .get_or_init_engine(&state.db, &gwp.game)
        .await?;

    Ok(Json(
        super::users::build_game_response(&state, id, &gwp, &engine).await,
    ))
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
pub(super) async fn delete_game(
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
pub(super) async fn join_game(
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

    Ok(Json(
        super::users::build_game_response(&state, id, &gwp, &engine).await,
    ))
}
