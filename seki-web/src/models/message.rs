use chrono::{DateTime, Utc};
use sqlx::FromRow;

#[derive(Debug, Clone, FromRow)]
#[allow(dead_code)] // Fields populated by SELECT * via sqlx
pub struct Message {
    pub id: i64,
    pub game_id: i64,
    pub user_id: Option<i64>,
    pub text: String,
    pub move_number: Option<i32>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

impl Message {
    pub async fn find_by_game_id(executor: impl sqlx::PgExecutor<'_>, game_id: i64) -> Result<Vec<Message>, sqlx::Error> {
        sqlx::query_as::<_, Message>(
            "SELECT * FROM messages WHERE game_id = $1 ORDER BY created_at ASC",
        )
        .bind(game_id)
        .fetch_all(executor)
        .await
    }

    pub async fn create(
        executor: impl sqlx::PgExecutor<'_>,
        game_id: i64,
        user_id: Option<i64>,
        text: &str,
        move_number: Option<i32>,
    ) -> Result<Message, sqlx::Error> {
        sqlx::query_as::<_, Message>(
            "INSERT INTO messages (game_id, user_id, text, move_number) VALUES ($1, $2, $3, $4) RETURNING *",
        )
        .bind(game_id)
        .bind(user_id)
        .bind(text)
        .bind(move_number)
        .fetch_one(executor)
        .await
    }

    pub async fn create_system(
        executor: impl sqlx::PgExecutor<'_>,
        game_id: i64,
        text: &str,
        move_number: Option<i32>,
    ) -> Result<Message, sqlx::Error> {
        Self::create(executor, game_id, None, text, move_number).await
    }
}
