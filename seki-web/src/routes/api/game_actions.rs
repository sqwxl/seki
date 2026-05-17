use axum::Json;
use axum::extract::{Path, State};
use serde::Deserialize;
use utoipa::ToSchema;

use crate::AppState;
use crate::error::{ApiError, AppError};
use crate::models::game::Game;
use crate::services::game_actions;
use crate::session::ApiUser;

use super::games::GameResponse;

#[derive(Deserialize, ToSchema)]
pub(crate) struct PlayRequest {
    col: i32,
    row: i32,
    /// Client-measured thinking time in milliseconds (for lag compensation).
    client_move_time_ms: Option<i64>,
}

#[derive(Deserialize, ToSchema)]
pub(crate) struct PassRequest {
    /// Client-measured thinking time in milliseconds (for lag compensation).
    client_move_time_ms: Option<i64>,
}

#[derive(Deserialize, ToSchema)]
pub(crate) struct UndoResponseRequest {
    response: String,
}

#[derive(Deserialize, ToSchema)]
pub(crate) struct ToggleChainRequest {
    col: u8,
    row: u8,
}

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
pub(super) async fn play_move(
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
    Ok(Json(
        super::users::build_game_response(&state, id, &gwp, &engine).await,
    ))
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
pub(super) async fn pass(
    State(state): State<AppState>,
    api_user: ApiUser,
    Path(id): Path<i64>,
    body: Option<Json<PassRequest>>,
) -> Result<Json<GameResponse>, ApiError> {
    let client_move_time_ms = body.and_then(|b| b.client_move_time_ms);
    let engine = game_actions::pass(&state, id, api_user.id, client_move_time_ms).await?;
    let gwp = Game::find_with_players(&state.db, id).await?;
    Ok(Json(
        super::users::build_game_response(&state, id, &gwp, &engine).await,
    ))
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
pub(super) async fn resign(
    State(state): State<AppState>,
    api_user: ApiUser,
    Path(id): Path<i64>,
) -> Result<Json<GameResponse>, ApiError> {
    let engine = game_actions::resign(&state, id, api_user.id).await?;
    let gwp = Game::find_with_players(&state.db, id).await?;
    Ok(Json(
        super::users::build_game_response(&state, id, &gwp, &engine).await,
    ))
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
pub(super) async fn abort(
    State(state): State<AppState>,
    api_user: ApiUser,
    Path(id): Path<i64>,
) -> Result<Json<serde_json::Value>, ApiError> {
    game_actions::abort(&state, id, api_user.id).await?;
    Ok(Json(serde_json::json!({ "status": "aborted" })))
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
pub(super) async fn request_undo(
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
pub(super) async fn respond_to_undo(
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
    Ok(Json(
        super::users::build_game_response(&state, id, &gwp, &engine).await,
    ))
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
pub(super) async fn toggle_chain(
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
    Ok(Json(
        super::users::build_game_response(&state, id, &gwp, &engine).await,
    ))
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
pub(super) async fn approve_territory(
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
    Ok(Json(
        super::users::build_game_response(&state, id, &gwp, &engine).await,
    ))
}
