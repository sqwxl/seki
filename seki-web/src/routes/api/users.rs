use axum::Json;
use axum::extract::{Path, State};
use serde::Serialize;
use utoipa::ToSchema;

use crate::AppState;
use crate::error::{ApiError, ApiErrorResponse, AppError};
use crate::models::game::Game;
use crate::models::user::User;
use crate::services::live::build_live_items;
use crate::services::state_serializer;
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
