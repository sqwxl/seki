use chrono::{DateTime, Utc};
use sqlx::FromRow;

#[derive(Debug, Clone, FromRow)]
pub struct FcmToken {
    pub id: i64,
    pub user_id: i64,
    pub token: String,
    pub device_type: Option<String>,
    pub enabled: bool,
    pub user_agent: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

impl FcmToken {
    pub async fn create(
        executor: impl sqlx::SqliteExecutor<'_>,
        user_id: i64,
        token: &str,
        device_type: Option<&str>,
        user_agent: Option<&str>,
    ) -> Result<FcmToken, sqlx::Error> {
        sqlx::query_as::<_, FcmToken>(
            "INSERT INTO fcm_tokens (user_id, token, device_type, user_agent) VALUES ($1, $2, $3, $4) RETURNING *",
        )
        .bind(user_id)
        .bind(token)
        .bind(device_type)
        .bind(user_agent)
        .fetch_one(executor)
        .await
    }

    pub async fn find_by_user_and_enabled(
        executor: impl sqlx::SqliteExecutor<'_>,
        user_id: i64,
    ) -> Result<Vec<FcmToken>, sqlx::Error> {
        sqlx::query_as::<_, FcmToken>("SELECT * FROM fcm_tokens WHERE user_id = $1 AND enabled = 1")
            .bind(user_id)
            .fetch_all(executor)
            .await
    }

    pub async fn find_by_token(
        executor: impl sqlx::SqliteExecutor<'_>,
        token: &str,
    ) -> Result<Option<FcmToken>, sqlx::Error> {
        sqlx::query_as::<_, FcmToken>("SELECT * FROM fcm_tokens WHERE token = $1")
            .bind(token)
            .fetch_optional(executor)
            .await
    }

    pub async fn find_by_user(
        executor: impl sqlx::SqliteExecutor<'_>,
        user_id: i64,
    ) -> Result<Vec<FcmToken>, sqlx::Error> {
        sqlx::query_as::<_, FcmToken>("SELECT * FROM fcm_tokens WHERE user_id = $1")
            .bind(user_id)
            .fetch_all(executor)
            .await
    }

    pub async fn disable(
        executor: impl sqlx::SqliteExecutor<'_>,
        id: i64,
    ) -> Result<(), sqlx::Error> {
        sqlx::query(
            "UPDATE fcm_tokens SET enabled = 0, updated_at = current_timestamp WHERE id = $1",
        )
        .bind(id)
        .execute(executor)
        .await
        .map(|_| ())
    }

    pub async fn count_for_user(
        executor: impl sqlx::SqliteExecutor<'_>,
        user_id: i64,
    ) -> Result<i64, sqlx::Error> {
        let row: (i64,) =
            sqlx::query_as("SELECT COUNT(*) FROM fcm_tokens WHERE user_id = $1 AND enabled = 1")
                .bind(user_id)
                .fetch_one(executor)
                .await?;
        Ok(row.0)
    }
}
