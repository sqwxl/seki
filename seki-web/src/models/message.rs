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

/// Message with the sender's display name resolved via JOIN.
#[derive(Debug, Clone, FromRow)]
pub struct MessageWithSender {
    pub user_id: Option<i64>,
    pub display_name: Option<String>,
    pub text: String,
    pub move_number: Option<i32>,
    pub created_at: DateTime<Utc>,
}

impl Message {
    pub async fn find_by_game_id(
        executor: impl sqlx::PgExecutor<'_>,
        game_id: i64,
    ) -> Result<Vec<Message>, sqlx::Error> {
        sqlx::query_as::<_, Message>(
            "SELECT * FROM messages WHERE game_id = $1 ORDER BY created_at ASC",
        )
        .bind(game_id)
        .fetch_all(executor)
        .await
    }

    pub async fn find_by_game_id_with_sender(
        executor: impl sqlx::PgExecutor<'_>,
        game_id: i64,
    ) -> Result<Vec<MessageWithSender>, sqlx::Error> {
        sqlx::query_as::<_, MessageWithSender>(
            "SELECT m.user_id, u.username AS display_name, m.text, m.move_number, m.created_at \
             FROM messages m LEFT JOIN users u ON m.user_id = u.id \
             WHERE m.game_id = $1 ORDER BY m.created_at ASC",
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
