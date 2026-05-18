use axum::Json;
use axum::extract::{Path, State};
use serde::Deserialize;
use utoipa::ToSchema;

use crate::AppState;
use crate::error::{ApiError, AppError};
use crate::models::game::Game;
use crate::services::game_creator::RatingRangePreference;
use crate::services::{game_actions, game_creator};
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
        ranked: false,
        rating_range: RatingRangePreference::Unlimited,
        open_game: false,
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
        super::users::build_game_response(&state, game.id, &gwp, &engine).await,
    ))
}
