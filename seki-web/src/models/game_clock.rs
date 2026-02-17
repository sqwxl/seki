use chrono::{DateTime, Utc};
use sqlx::FromRow;

use crate::db::DbPool;

#[derive(Debug, Clone, FromRow)]
pub struct GameClock {
    pub game_id: i64,
    pub black_remaining_ms: i64,
    pub white_remaining_ms: i64,
    pub black_periods_remaining: i32,
    pub white_periods_remaining: i32,
    pub active_stone: Option<i32>,
    pub last_move_at: Option<DateTime<Utc>>,
    pub created_at: Option<DateTime<Utc>>,
    pub updated_at: Option<DateTime<Utc>>,
}

impl GameClock {
    pub async fn find_by_game_id(
        pool: &DbPool,
        game_id: i64,
    ) -> Result<Option<GameClock>, sqlx::Error> {
        sqlx::query_as::<_, GameClock>("SELECT * FROM game_clocks WHERE game_id = $1")
            .bind(game_id)
            .fetch_optional(pool)
            .await
    }

    pub async fn create(
        pool: &DbPool,
        game_id: i64,
        black_remaining_ms: i64,
        white_remaining_ms: i64,
        black_periods: i32,
        white_periods: i32,
    ) -> Result<GameClock, sqlx::Error> {
        sqlx::query_as::<_, GameClock>(
            "INSERT INTO game_clocks (game_id, black_remaining_ms, white_remaining_ms, black_periods_remaining, white_periods_remaining)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING *",
        )
        .bind(game_id)
        .bind(black_remaining_ms)
        .bind(white_remaining_ms)
        .bind(black_periods)
        .bind(white_periods)
        .fetch_one(pool)
        .await
    }

    pub async fn update(
        pool: &DbPool,
        game_id: i64,
        black_remaining_ms: i64,
        white_remaining_ms: i64,
        black_periods: i32,
        white_periods: i32,
        active_stone: Option<i32>,
        last_move_at: Option<DateTime<Utc>>,
    ) -> Result<GameClock, sqlx::Error> {
        sqlx::query_as::<_, GameClock>(
            "UPDATE game_clocks SET black_remaining_ms = $2, white_remaining_ms = $3, black_periods_remaining = $4, white_periods_remaining = $5, active_stone = $6, last_move_at = $7, updated_at = NOW() WHERE game_id = $1 RETURNING *",
        )
        .bind(game_id)
        .bind(black_remaining_ms)
        .bind(white_remaining_ms)
        .bind(black_periods)
        .bind(white_periods)
        .bind(active_stone)
        .bind(last_move_at)
        .fetch_one(pool)
        .await
    }
}
