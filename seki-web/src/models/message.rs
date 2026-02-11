use chrono::{DateTime, Utc};
use sqlx::FromRow;

use crate::db::DbPool;

#[derive(Debug, Clone, FromRow)]
#[allow(dead_code)] // Fields populated by SELECT * via sqlx
pub struct Message {
    pub id: i64,
    pub game_id: i64,
    pub player_id: i64,
    pub text: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

impl Message {
    pub async fn find_by_game_id(
        pool: &DbPool,
        game_id: i64,
    ) -> Result<Vec<Message>, sqlx::Error> {
        sqlx::query_as::<_, Message>(
            "SELECT * FROM messages WHERE game_id = $1 ORDER BY created_at ASC",
        )
        .bind(game_id)
        .fetch_all(pool)
        .await
    }

    pub async fn create(
        pool: &DbPool,
        game_id: i64,
        player_id: i64,
        text: &str,
    ) -> Result<Message, sqlx::Error> {
        sqlx::query_as::<_, Message>(
            "INSERT INTO messages (game_id, player_id, text) VALUES ($1, $2, $3) RETURNING *",
        )
        .bind(game_id)
        .bind(player_id)
        .bind(text)
        .fetch_one(pool)
        .await
    }
}
