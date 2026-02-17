use chrono::{DateTime, Utc};
use sqlx::FromRow;

use crate::db::DbPool;

#[derive(Debug, Clone, FromRow)]
#[allow(dead_code)] // Fields populated by SELECT * via sqlx
pub struct TurnRow {
    pub id: i64,
    pub game_id: i64,
    pub player_id: i64,
    pub turn_number: i32,
    pub kind: String,
    pub stone: i32,
    pub col: Option<i32>,
    pub row: Option<i32>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

impl TurnRow {
    pub async fn find_by_game_id(pool: &DbPool, game_id: i64) -> Result<Vec<TurnRow>, sqlx::Error> {
        sqlx::query_as::<_, TurnRow>(
            "SELECT * FROM turns WHERE game_id = $1 ORDER BY turn_number ASC",
        )
        .bind(game_id)
        .fetch_all(pool)
        .await
    }

    pub async fn count_by_game_id(pool: &DbPool, game_id: i64) -> Result<i64, sqlx::Error> {
        let row: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM turns WHERE game_id = $1")
            .bind(game_id)
            .fetch_one(pool)
            .await?;
        Ok(row.0)
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn create(
        pool: &DbPool,
        game_id: i64,
        player_id: i64,
        turn_number: i32,
        kind: &str,
        stone: i32,
        col: Option<i32>,
        row: Option<i32>,
    ) -> Result<TurnRow, sqlx::Error> {
        sqlx::query_as::<_, TurnRow>(
            "INSERT INTO turns (game_id, player_id, turn_number, kind, stone, col, row)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             RETURNING *",
        )
        .bind(game_id)
        .bind(player_id)
        .bind(turn_number)
        .bind(kind)
        .bind(stone)
        .bind(col)
        .bind(row)
        .fetch_one(pool)
        .await
    }

    pub async fn delete_last(pool: &DbPool, game_id: i64) -> Result<(), sqlx::Error> {
        sqlx::query(
            "DELETE FROM turns WHERE id = (
                SELECT id FROM turns WHERE game_id = $1 ORDER BY turn_number DESC LIMIT 1
            )",
        )
        .bind(game_id)
        .execute(pool)
        .await?;
        Ok(())
    }

    pub async fn last_turn(pool: &DbPool, game_id: i64) -> Result<Option<TurnRow>, sqlx::Error> {
        sqlx::query_as::<_, TurnRow>(
            "SELECT * FROM turns WHERE game_id = $1 ORDER BY turn_number DESC LIMIT 1",
        )
        .bind(game_id)
        .fetch_optional(pool)
        .await
    }
}
