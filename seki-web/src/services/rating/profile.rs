use chrono::{DateTime, Utc};
use serde::Serialize;
use sqlx::FromRow;

use crate::db::DbPool;
use crate::error::AppError;
use crate::models::game::Game;
use crate::models::game::TimeControlType;
use crate::models::rating::{RatingAdjustment, RatingProfile};
use crate::models::user::User;
use crate::services::game_access::{GameViewTokens, can_view_game};
use crate::services::rating::{
    PROVISIONAL_DEVIATION_THRESHOLD, RankDto, RankStatus, RatingCalibrationPolicy, rank_for_user,
};

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
    pub ended_at: Option<DateTime<Utc>>,
    pub black_player: Option<String>,
    pub white_player: Option<String>,
    pub black_rank_before: Option<RankDto>,
    pub white_rank_before: Option<RankDto>,
    pub cols: i32,
    pub rows: i32,
    pub handicap: i32,
    pub komi: f64,
    pub time_control: TimeControlType,
    pub main_time_secs: Option<i32>,
    pub increment_secs: Option<i32>,
    pub byoyomi_time_secs: Option<i32>,
    pub byoyomi_periods: Option<i32>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ProfileStatsDto {
    pub total_games: i64,
    pub rated_games: i32,
    pub wins: i64,
    pub losses: i64,
    pub avg_opponent_rating: Option<f64>,
    pub highest_rating: Option<f64>,
    pub lowest_rating: Option<f64>,
    pub time_spent_secs: i64,
    pub win_streak_longest: i32,
    pub win_streak_current: i32,
    pub lose_streak_longest: i32,
    pub lose_streak_current: i32,
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
    pub stats: ProfileStatsDto,
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
    let stats = compute_profile_stats(pool, profile_user.id, &profile).await?;

    Ok(Some(ProfileRatingDto {
        participating: profile.participating,
        rating: profile.rating,
        deviation: profile.deviation,
        volatility: profile.volatility,
        rank: rank_for_user(profile_user, Some(&profile)),
        rated_games: profile.rated_games,
        history,
        stats,
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
            ended_at: gwp.game.ended_at,
            black_player: gwp
                .black
                .as_ref()
                .map(|user| user.display_name().to_string()),
            white_player: gwp
                .white
                .as_ref()
                .map(|user| user.display_name().to_string()),
            black_rank_before: rank_from_snapshot(&gwp.game, true),
            white_rank_before: rank_from_snapshot(&gwp.game, false),
            cols: gwp.game.cols,
            rows: gwp.game.rows,
            handicap: gwp.game.handicap,
            komi: gwp.game.komi,
            time_control: gwp.game.time_control,
            main_time_secs: gwp.game.main_time_secs,
            increment_secs: gwp.game.increment_secs,
            byoyomi_time_secs: gwp.game.byoyomi_time_secs,
            byoyomi_periods: gwp.game.byoyomi_periods,
        });
    }

    Ok(visible)
}

fn rank_from_snapshot(game: &Game, is_black: bool) -> Option<RankDto> {
    let (rating, deviation, volatility) = if is_black {
        (
            game.black_rating_before?,
            game.black_deviation_before?,
            game.black_volatility_before?,
        )
    } else {
        (
            game.white_rating_before?,
            game.white_deviation_before?,
            game.white_volatility_before?,
        )
    };

    Some(RankDto {
        qualifier: Some(RatingCalibrationPolicy::default().rank_label(rating)),
        status: RankStatus::Ranked,
        rating: Some(rating),
        deviation: Some(deviation),
        volatility: Some(volatility),
        uncertain: deviation > PROVISIONAL_DEVIATION_THRESHOLD,
    })
}

#[derive(Debug, FromRow)]
struct GameResultRow {
    result: String,
    black_id: i64,
}

#[derive(Debug, FromRow)]
struct WinLossCount {
    wins: i64,
    losses: i64,
}

async fn compute_profile_stats(
    pool: &DbPool,
    user_id: i64,
    profile: &RatingProfile,
) -> Result<ProfileStatsDto, AppError> {
    let total_games: (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM games \
         WHERE (black_id = $1 OR white_id = $1) \
         AND result IS NOT NULL \
         AND result != 'Aborted' \
         AND result != 'Declined'",
    )
    .bind(user_id)
    .fetch_one(pool)
    .await?;

    let win_loss: WinLossCount = sqlx::query_as(
        "SELECT \
            COUNT(*) FILTER (WHERE (black_id = $1 AND result LIKE 'B+%') OR (white_id = $1 AND result LIKE 'W+%')) AS wins, \
            COUNT(*) FILTER (WHERE (black_id = $1 AND result LIKE 'W+%') OR (white_id = $1 AND result LIKE 'B+%')) AS losses \
         FROM games \
         WHERE (black_id = $1 OR white_id = $1) \
         AND result IS NOT NULL \
         AND result != 'Aborted' \
         AND result != 'Declined'",
    )
    .bind(user_id)
    .fetch_one(pool)
    .await?;

    let avg_opponent: Option<(f64,)> = sqlx::query_as(
        "SELECT AVG(opponent_rating_before) FROM rating_adjustments WHERE user_id = $1",
    )
    .bind(user_id)
    .fetch_optional(pool)
    .await?;
    let avg_opponent_rating =
        avg_opponent.and_then(|(avg,)| if avg > 0.0 { Some(avg) } else { None });

    let rating_extremes: Option<(f64, f64)> = sqlx::query_as(
        "SELECT MAX(rating_after), MIN(rating_after) FROM rating_adjustments WHERE user_id = $1",
    )
    .bind(user_id)
    .fetch_optional(pool)
    .await?;

    let (highest_rating, lowest_rating) = match rating_extremes {
        Some((max, min)) if max > 0.0 => {
            let hi = if profile.rating > max {
                profile.rating
            } else {
                max
            };
            let lo = if profile.rating < min {
                profile.rating
            } else {
                min
            };
            (Some(hi), Some(lo))
        }
        _ => {
            if profile.rated_games > 0 {
                (Some(profile.rating), Some(profile.rating))
            } else {
                (None, None)
            }
        }
    };

    let time_spent: (i64,) = sqlx::query_as(
        "SELECT COALESCE(SUM( \
            CAST((julianday(COALESCE(ended_at, updated_at)) - julianday(started_at)) * 86400 AS INTEGER) \
         ), 0) FROM games \
         WHERE (black_id = $1 OR white_id = $1) \
         AND started_at IS NOT NULL \
         AND result IS NOT NULL \
         AND result != 'Aborted' \
         AND result != 'Declined'",
    )
    .bind(user_id)
    .fetch_one(pool)
    .await?;

    let streaks = compute_streaks(pool, user_id).await?;

    Ok(ProfileStatsDto {
        total_games: total_games.0,
        rated_games: profile.rated_games,
        wins: win_loss.wins,
        losses: win_loss.losses,
        avg_opponent_rating,
        highest_rating,
        lowest_rating,
        time_spent_secs: time_spent.0,
        win_streak_longest: streaks.win_longest,
        win_streak_current: streaks.win_current,
        lose_streak_longest: streaks.lose_longest,
        lose_streak_current: streaks.lose_current,
    })
}

struct Streaks {
    win_longest: i32,
    win_current: i32,
    lose_longest: i32,
    lose_current: i32,
}

async fn compute_streaks(pool: &DbPool, user_id: i64) -> Result<Streaks, AppError> {
    let rows: Vec<GameResultRow> = sqlx::query_as(
        "SELECT result, black_id FROM games \
         WHERE (black_id = $1 OR white_id = $1) \
         AND result IS NOT NULL \
         AND result != 'Aborted' \
         AND result != 'Declined' \
         ORDER BY COALESCE(ended_at, updated_at) ASC",
    )
    .bind(user_id)
    .fetch_all(pool)
    .await?;

    // Compute per-game bool: true = win, false = loss, skip draws
    let outcomes: Vec<bool> = rows
        .iter()
        .filter_map(|row| {
            let is_black = row.black_id == user_id;
            if row.result.starts_with("B+") {
                Some(is_black)
            } else if row.result.starts_with("W+") {
                Some(!is_black)
            } else {
                None // draw or unknown
            }
        })
        .collect();

    let mut win_longest = 0i32;
    let mut win_current = 0i32;
    let mut lose_longest = 0i32;
    let mut lose_current = 0i32;

    for &win in &outcomes {
        if win {
            win_current += 1;
            lose_current = 0;
            win_longest = win_longest.max(win_current);
        } else {
            lose_current += 1;
            win_current = 0;
            lose_longest = lose_longest.max(lose_current);
        }
    }

    Ok(Streaks {
        win_longest,
        win_current,
        lose_longest,
        lose_current,
    })
}
