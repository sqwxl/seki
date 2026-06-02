use chrono::{DateTime, Utc};
use sqlx::FromRow;

#[derive(Debug, Clone, FromRow)]
pub struct PregameSettingsNegotiation {
    pub game_id: i64,
    pub handicap: i32,
    pub komi: f64,
    pub color: String,
    pub creator_approved: bool,
    pub opponent_approved: bool,
    pub expires_at: Option<DateTime<Utc>>,
}

impl PregameSettingsNegotiation {
    pub async fn upsert_initial(
        executor: impl sqlx::SqliteExecutor<'_>,
        game_id: i64,
        handicap: i32,
        komi: f64,
        color: &str,
    ) -> Result<Self, sqlx::Error> {
        sqlx::query_as::<_, Self>(
            "INSERT INTO pregame_setting_negotiations (game_id, handicap, komi, color) \
             VALUES ($1, $2, $3, $4) \
             ON CONFLICT(game_id) DO UPDATE SET \
             handicap = excluded.handicap, komi = excluded.komi, color = excluded.color, \
             creator_approved = false, opponent_approved = false, expires_at = NULL, updated_at = CURRENT_TIMESTAMP \
             RETURNING game_id, handicap, komi, color, creator_approved, opponent_approved, expires_at",
        )
        .bind(game_id)
        .bind(handicap)
        .bind(komi)
        .bind(color)
        .fetch_one(executor)
        .await
    }

    pub async fn update_proposal(
        executor: impl sqlx::SqliteExecutor<'_>,
        game_id: i64,
        handicap: i32,
        komi: f64,
        color: &str,
    ) -> Result<Self, sqlx::Error> {
        sqlx::query_as::<_, Self>(
            "UPDATE pregame_setting_negotiations SET \
             handicap = $2, komi = $3, color = $4, \
             creator_approved = false, opponent_approved = false, expires_at = NULL, updated_at = CURRENT_TIMESTAMP \
             WHERE game_id = $1 \
             RETURNING game_id, handicap, komi, color, creator_approved, opponent_approved, expires_at",
        )
        .bind(game_id)
        .bind(handicap)
        .bind(komi)
        .bind(color)
        .fetch_one(executor)
        .await
    }

    pub async fn find(
        executor: impl sqlx::SqliteExecutor<'_>,
        game_id: i64,
    ) -> Result<Option<Self>, sqlx::Error> {
        sqlx::query_as::<_, Self>(
            "SELECT game_id, handicap, komi, color, creator_approved, opponent_approved, expires_at \
             FROM pregame_setting_negotiations WHERE game_id = $1",
        )
        .bind(game_id)
        .fetch_optional(executor)
        .await
    }

    pub async fn set_approved(
        executor: impl sqlx::SqliteExecutor<'_>,
        game_id: i64,
        creator_approved: bool,
        opponent_approved: bool,
        expires_at: Option<DateTime<Utc>>,
    ) -> Result<Self, sqlx::Error> {
        sqlx::query_as::<_, Self>(
            "UPDATE pregame_setting_negotiations SET \
             creator_approved = $2, opponent_approved = $3, expires_at = $4, updated_at = CURRENT_TIMESTAMP \
             WHERE game_id = $1 \
             RETURNING game_id, handicap, komi, color, creator_approved, opponent_approved, expires_at",
        )
        .bind(game_id)
        .bind(creator_approved)
        .bind(opponent_approved)
        .bind(expires_at)
        .fetch_one(executor)
        .await
    }

    pub async fn delete(
        executor: impl sqlx::SqliteExecutor<'_>,
        game_id: i64,
    ) -> Result<(), sqlx::Error> {
        sqlx::query("DELETE FROM pregame_setting_negotiations WHERE game_id = $1")
            .bind(game_id)
            .execute(executor)
            .await?;
        Ok(())
    }
}
