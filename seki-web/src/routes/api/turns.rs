use axum::Json;
use axum::extract::{Path, Query, State};
use chrono::{DateTime, Utc};
use serde::Serialize;
use utoipa::ToSchema;

use crate::AppState;
use crate::error::{ApiError, AppError};
use crate::models::game::Game;
use crate::models::turn::TurnRow;
use crate::session::OptionalApiUser;

use super::games::GetGameQuery;

#[derive(Serialize, ToSchema)]
pub(crate) struct TurnResponse {
    id: i64,
    turn_number: i32,
    kind: String,
    stone: i32,
    col: Option<i32>,
    row: Option<i32>,
    user_id: i64,
    created_at: DateTime<Utc>,
}

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
pub(super) async fn get_turns(
    State(state): State<AppState>,
    OptionalApiUser(api_user): OptionalApiUser,
    Query(query): Query<GetGameQuery>,
    Path(id): Path<i64>,
) -> Result<Json<Vec<TurnResponse>>, ApiError> {
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
