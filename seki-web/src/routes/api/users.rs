use axum::Json;
use axum::extract::{Path, State};
use serde::Serialize;
use utoipa::ToSchema;

use crate::AppState;
use crate::error::{ApiError, ApiErrorResponse, AppError};
use crate::models::game::Game;
use crate::models::user::User;
use crate::services::live::build_live_items;
use crate::services::state_assembly;
use crate::session::{ApiUser, OptionalApiUser};

use super::games::GameResponse;

#[derive(Serialize, ToSchema)]
pub(crate) struct UserResponse {
    id: i64,
    username: String,
    is_registered: bool,
}

impl UserResponse {
    pub(crate) fn from_user(p: &User) -> Self {
        Self {
            id: p.id,
            username: p.username.clone(),
            is_registered: p.is_registered(),
        }
    }
}

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
pub(super) async fn get_user(
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
pub(super) async fn get_user_games(
    State(state): State<AppState>,
    OptionalApiUser(api_user): OptionalApiUser,
    Path(username): Path<String>,
) -> Result<Json<Vec<crate::services::live::LiveGameItem>>, ApiError> {
    let user = User::find_by_username(&state.db, &username)
        .await?
        .ok_or_else(|| AppError::NotFound("User not found".to_string()))?;
    let mut games = Game::list_all_for_player(&state.db, user.id).await?;
    games.retain(|gwp| {
        crate::services::game_access::can_view_game(
            gwp,
            api_user.as_ref().map(|u| u.id),
            crate::services::game_access::GameViewTokens::default(),
        )
    });
    let items = build_live_items(&state.db, &games).await;
    Ok(Json(items))
}

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
pub(super) async fn get_me(api_user: ApiUser) -> Json<UserResponse> {
    Json(UserResponse::from_user(&api_user))
}

pub(crate) async fn build_game_response(
    state: &AppState,
    game_id: i64,
    gwp: &crate::models::game::GameWithPlayers,
    engine: &go_engine::Engine,
) -> GameResponse {
    let Ok(loaded) = state_assembly::load_game_state(state, gwp, engine, game_id, false).await
    else {
        return GameResponse {
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
            opponent: gwp.opponent.as_ref().map(UserResponse::from_user),
            created_at: gwp.game.created_at,
            started_at: gwp.game.started_at,
            ended_at: gwp.game.ended_at,
            stage: String::new(),
            state: serde_json::Value::Null,
            current_turn_stone: 0,
            negotiations: serde_json::Value::Null,
            territory: None,
            clock: None,
        };
    };

    let territory_json = loaded.value.get("territory").cloned();
    let clock_json = loaded.value.get("clock").cloned();

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
        opponent: gwp.opponent.as_ref().map(UserResponse::from_user),
        created_at: gwp.game.created_at,
        started_at: gwp.game.started_at,
        ended_at: gwp.game.ended_at,
        stage: loaded.value["stage"]
            .as_str()
            .unwrap_or("unknown")
            .to_string(),
        state: loaded.value["state"].clone(),
        current_turn_stone: loaded.value["current_turn_stone"].as_i64().unwrap_or(1) as i32,
        negotiations: loaded.value["negotiations"].clone(),
        territory: territory_json,
        clock: clock_json,
    }
}
