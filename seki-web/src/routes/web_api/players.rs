use axum::Json;
use axum::extract::{Query, State};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use crate::AppState;
use crate::error::AppError;
use crate::models::rating::{PlayerDirectoryFilters, list_player_directory};
use crate::services::rating::rank_for_user;
use crate::views::{UserData, user_data_from_user_with_rank};

const DEFAULT_LIMIT: i64 = 50;
const MAX_LIMIT: i64 = 100;

#[derive(Debug, Clone, Deserialize)]
pub(crate) struct PlayersQuery {
    pub offset: Option<i64>,
    pub limit: Option<i64>,
    pub exclude_uncertain: Option<bool>,
    pub include_unranked: Option<bool>,
    pub online_now: Option<bool>,
}

#[derive(Debug, Clone, Serialize)]
pub(crate) struct PlayerDirectoryItem {
    pub user: UserData,
    pub is_online: bool,
    pub wins: i64,
    pub losses: i64,
    pub rating_trend: Vec<f64>,
    pub last_active_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize)]
pub(crate) struct PlayersData {
    pub players: Vec<PlayerDirectoryItem>,
    pub offset: i64,
    pub limit: i64,
    pub has_more: bool,
}

pub(crate) async fn players_index(
    State(state): State<AppState>,
    Query(query): Query<PlayersQuery>,
) -> Result<Json<PlayersData>, AppError> {
    Ok(Json(load_players_index(&state, query).await?))
}

pub(crate) async fn load_players_index(
    state: &AppState,
    query: PlayersQuery,
) -> Result<PlayersData, AppError> {
    let limit = query.limit.unwrap_or(DEFAULT_LIMIT).clamp(1, MAX_LIMIT);
    let offset = query.offset.unwrap_or(0).max(0);
    let online_ids = if query.online_now.unwrap_or(false) {
        Some(state.presence.all_connected_ids().await)
    } else {
        None
    };
    let filters = PlayerDirectoryFilters {
        exclude_uncertain: query.exclude_uncertain.unwrap_or(true),
        include_unranked: query.include_unranked.unwrap_or(false),
        online_ids,
        limit: limit + 1,
        offset,
    };
    let rows = list_player_directory(&state.db, &filters).await?;
    let has_more = rows.len() > limit as usize;
    let rows = rows.into_iter().take(limit as usize).collect::<Vec<_>>();
    let user_ids: Vec<i64> = rows.iter().map(|row| row.user.id).collect();
    let online = state.presence.connected_ids(&user_ids).await;

    let players = rows
        .into_iter()
        .map(|row| {
            let mut user = user_data_from_user_with_rank(&row.user, row.profile.as_ref());
            if user.rank.is_none() {
                user.rank = Some(rank_for_user(&row.user, row.profile.as_ref()));
            }
            PlayerDirectoryItem {
                is_online: online.contains(&row.user.id),
                user,
                wins: row.wins,
                losses: row.losses,
                rating_trend: row.rating_trend,
                last_active_at: row.last_active_at,
            }
        })
        .collect();

    Ok(PlayersData {
        players,
        offset,
        limit,
        has_more,
    })
}
