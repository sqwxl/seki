use chrono::{DateTime, Utc};
use serde::Serialize;

use crate::db::DbPool;
use crate::error::AppError;
use crate::models::game::Game;
use crate::models::rating::{RatingAdjustment, RatingProfile};
use crate::models::user::User;
use crate::services::game_access::{GameViewTokens, can_view_game};
use crate::services::rating::{RankDto, rank_for_user};

#[derive(Debug, Clone, Serialize)]
pub struct RatingHistoryEntryDto {
    pub game_id: i64,
    pub result: String,
    pub rating_before: f64,
    pub rating_after: f64,
    pub deviation_before: f64,
    pub deviation_after: f64,
    pub volatility_before: f64,
    pub volatility_after: f64,
    pub rating_delta: f64,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ProfileRatingDto {
    pub participating: bool,
    pub rating: f64,
    pub deviation: f64,
    pub volatility: f64,
    pub rank: RankDto,
    pub rated_games: i32,
    pub history: Vec<RatingHistoryEntryDto>,
}

pub async fn profile_rating_summary(
    pool: &DbPool,
    profile_user: &User,
    viewer_id: i64,
) -> Result<Option<ProfileRatingDto>, AppError> {
    if !profile_user.is_registered() {
        return Ok(None);
    }

    let profile = RatingProfile::get_or_create(pool, profile_user.id).await?;
    let history = visible_rating_history(pool, profile_user.id, viewer_id).await?;

    Ok(Some(ProfileRatingDto {
        participating: profile.participating,
        rating: profile.rating,
        deviation: profile.deviation,
        volatility: profile.volatility,
        rank: rank_for_user(profile_user, Some(&profile)),
        rated_games: profile.rated_games,
        history,
    }))
}

async fn visible_rating_history(
    pool: &DbPool,
    user_id: i64,
    viewer_id: i64,
) -> Result<Vec<RatingHistoryEntryDto>, AppError> {
    let adjustments = RatingAdjustment::list_for_user(pool, user_id).await?;
    let mut visible = Vec::new();

    for adjustment in adjustments {
        let Ok(gwp) = Game::find_with_players(pool, adjustment.game_id).await else {
            continue;
        };
        if !can_view_game(&gwp, Some(viewer_id), GameViewTokens::default()) {
            continue;
        }
        visible.push(RatingHistoryEntryDto {
            game_id: adjustment.game_id,
            result: adjustment.result,
            rating_before: adjustment.rating_before,
            rating_after: adjustment.rating_after,
            deviation_before: adjustment.deviation_before,
            deviation_after: adjustment.deviation_after,
            volatility_before: adjustment.volatility_before,
            volatility_after: adjustment.volatility_after,
            rating_delta: adjustment.rating_delta,
            created_at: adjustment.created_at,
        });
    }

    Ok(visible)
}
