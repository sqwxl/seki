//! Persistence helpers for player rating state.

use std::collections::HashMap;

use chrono::{DateTime, Utc};
use sqlx::FromRow;

use crate::db::DbPool;

#[derive(Debug, Clone, FromRow)]
pub struct RatingProfile {
    pub user_id: i64,
    pub participating: bool,
    pub rating: f64,
    pub deviation: f64,
    pub volatility: f64,
    pub rated_games: i32,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, FromRow)]
pub struct RatingAdjustment {
    pub id: i64,
    pub user_id: i64,
    pub game_id: i64,
    pub opponent_id: i64,
    pub result: String,
    pub rating_before: f64,
    pub rating_after: f64,
    pub deviation_before: f64,
    pub deviation_after: f64,
    pub volatility_before: f64,
    pub volatility_after: f64,
    pub rating_delta: f64,
    pub opponent_rating_before: f64,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone)]
pub struct NewRatingAdjustment<'a> {
    pub user_id: i64,
    pub game_id: i64,
    pub opponent_id: i64,
    pub result: &'a str,
    pub rating_before: f64,
    pub rating_after: f64,
    pub deviation_before: f64,
    pub deviation_after: f64,
    pub volatility_before: f64,
    pub volatility_after: f64,
    pub opponent_rating_before: f64,
}

impl RatingProfile {
    pub async fn find(
        executor: impl sqlx::SqliteExecutor<'_>,
        user_id: i64,
    ) -> Result<Option<Self>, sqlx::Error> {
        sqlx::query_as::<_, Self>("SELECT * FROM rating_profiles WHERE user_id = $1")
            .bind(user_id)
            .fetch_optional(executor)
            .await
    }

    pub async fn find_batch(
        pool: &DbPool,
        user_ids: &[i64],
    ) -> Result<HashMap<i64, Self>, sqlx::Error> {
        if user_ids.is_empty() {
            return Ok(HashMap::new());
        }
        let ids_json = serde_json::to_string(user_ids).unwrap_or_default();
        let rows: Vec<Self> = sqlx::query_as(
            "SELECT * FROM rating_profiles WHERE user_id IN (SELECT value FROM json_each($1))",
        )
        .bind(&ids_json)
        .fetch_all(pool)
        .await?;
        Ok(rows.into_iter().map(|p| (p.user_id, p)).collect())
    }

    pub async fn get_or_create(pool: &DbPool, user_id: i64) -> Result<Self, sqlx::Error> {
        sqlx::query(
            "INSERT INTO rating_profiles (user_id) VALUES ($1) \
             ON CONFLICT (user_id) DO NOTHING",
        )
        .bind(user_id)
        .execute(pool)
        .await?;

        sqlx::query_as::<_, Self>("SELECT * FROM rating_profiles WHERE user_id = $1")
            .bind(user_id)
            .fetch_one(pool)
            .await
    }

    pub async fn set_participating(
        executor: impl sqlx::SqliteExecutor<'_>,
        user_id: i64,
        participating: bool,
    ) -> Result<(), sqlx::Error> {
        sqlx::query(
            "INSERT INTO rating_profiles (user_id, participating) VALUES ($1, $2) \
             ON CONFLICT (user_id) DO UPDATE SET \
             participating = excluded.participating, updated_at = CURRENT_TIMESTAMP",
        )
        .bind(user_id)
        .bind(participating)
        .execute(executor)
        .await?;
        Ok(())
    }

    pub async fn update_rating(
        executor: impl sqlx::SqliteExecutor<'_>,
        user_id: i64,
        rating: f64,
        deviation: f64,
        volatility: f64,
    ) -> Result<(), sqlx::Error> {
        sqlx::query(
            "UPDATE rating_profiles SET \
             rating = $2, deviation = $3, volatility = $4, \
             rated_games = rated_games + 1, updated_at = CURRENT_TIMESTAMP \
             WHERE user_id = $1",
        )
        .bind(user_id)
        .bind(rating)
        .bind(deviation)
        .bind(volatility)
        .execute(executor)
        .await?;
        Ok(())
    }
}

impl RatingAdjustment {
    pub async fn insert(
        executor: impl sqlx::SqliteExecutor<'_>,
        adjustment: &NewRatingAdjustment<'_>,
    ) -> Result<bool, sqlx::Error> {
        let result = sqlx::query(
            "INSERT OR IGNORE INTO rating_adjustments \
             (user_id, game_id, opponent_id, result, rating_before, rating_after, \
              deviation_before, deviation_after, volatility_before, volatility_after, \
              rating_delta, opponent_rating_before) \
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)",
        )
        .bind(adjustment.user_id)
        .bind(adjustment.game_id)
        .bind(adjustment.opponent_id)
        .bind(adjustment.result)
        .bind(adjustment.rating_before)
        .bind(adjustment.rating_after)
        .bind(adjustment.deviation_before)
        .bind(adjustment.deviation_after)
        .bind(adjustment.volatility_before)
        .bind(adjustment.volatility_after)
        .bind(adjustment.rating_after - adjustment.rating_before)
        .bind(adjustment.opponent_rating_before)
        .execute(executor)
        .await?;
        Ok(result.rows_affected() > 0)
    }

    pub async fn list_for_user(
        executor: impl sqlx::SqliteExecutor<'_>,
        user_id: i64,
    ) -> Result<Vec<Self>, sqlx::Error> {
        sqlx::query_as::<_, Self>(
            "SELECT * FROM rating_adjustments \
             WHERE user_id = $1 \
             ORDER BY created_at ASC, id ASC",
        )
        .bind(user_id)
        .fetch_all(executor)
        .await
    }
}
