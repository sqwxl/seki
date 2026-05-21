use axum::Json;
use axum::extract::{Path, State};
use serde::Deserialize;
use utoipa::ToSchema;

use crate::AppState;
use crate::error::ApiError;
use crate::models::game::Game;
use crate::services::game_actions;
use crate::session::ApiUser;

use super::games::GameResponse;

#[derive(Deserialize, ToSchema)]
pub(crate) struct RematchRequest {
    swap_colors: Option<bool>,
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
pub(super) async fn accept_challenge(
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
pub(super) async fn decline_challenge(
    State(state): State<AppState>,
    api_user: ApiUser,
    Path(id): Path<i64>,
) -> Result<Json<serde_json::Value>, ApiError> {
    game_actions::decline_challenge(&state, id, api_user.id).await?;
    Ok(Json(serde_json::json!({ "status": "declined" })))
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
pub(super) async fn rematch_game(
    State(state): State<AppState>,
    api_user: ApiUser,
    Path(id): Path<i64>,
    Json(body): Json<RematchRequest>,
) -> Result<Json<GameResponse>, ApiError> {
    let swap = body.swap_colors.unwrap_or(false);
    let new_id = game_actions::rematch_game(&state, &api_user, id, swap).await?;

    let gwp = Game::find_with_players(&state.db, new_id).await?;
    let engine = state
        .registry
        .get_or_init_engine(&state.db, &gwp.game)
        .await?;

    Ok(Json(
        super::users::build_game_response(&state, new_id, &gwp, &engine).await,
    ))
}
