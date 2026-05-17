use axum::Json;
use axum::extract::{Path, Query, State};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::AppState;
use crate::error::{ApiError, AppError};
use crate::models::game::Game;
use crate::models::message::Message;
use crate::services::game_actions;
use crate::session::{ApiUser, OptionalApiUser};

use super::games::GetGameQuery;

#[derive(Serialize, ToSchema)]
pub(crate) struct MessageResponse {
    id: i64,
    user_id: Option<i64>,
    text: String,
    move_number: Option<i32>,
    created_at: DateTime<Utc>,
}

#[derive(Deserialize, ToSchema)]
pub(crate) struct ChatRequest {
    text: String,
}

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
pub(super) async fn get_messages(
    State(state): State<AppState>,
    OptionalApiUser(api_user): OptionalApiUser,
    Query(query): Query<GetGameQuery>,
    Path(id): Path<i64>,
) -> Result<Json<Vec<MessageResponse>>, ApiError> {
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
pub(super) async fn send_message(
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
