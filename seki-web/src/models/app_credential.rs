use chrono::{DateTime, Utc};
use sqlx::FromRow;

#[derive(Debug, Clone, FromRow)]
#[allow(dead_code)]
pub struct AppCredential {
    pub id: i64,
    pub user_id: i64,
    pub jti: String,
    pub expires_at: String,
    pub revoked: bool,
    pub created_at: DateTime<Utc>,
}

impl AppCredential {
    pub async fn create(
        executor: impl sqlx::SqliteExecutor<'_>,
        user_id: i64,
        jti: &str,
        expires_at: &str,
    ) -> Result<AppCredential, sqlx::Error> {
        sqlx::query_as::<_, AppCredential>(
            "INSERT INTO app_credentials (user_id, jti, expires_at) VALUES ($1, $2, $3) RETURNING *",
        )
        .bind(user_id)
        .bind(jti)
        .bind(expires_at)
        .fetch_one(executor)
        .await
    }

    pub async fn find_by_jti(
        executor: impl sqlx::SqliteExecutor<'_>,
        jti: &str,
    ) -> Result<Option<AppCredential>, sqlx::Error> {
        sqlx::query_as::<_, AppCredential>("SELECT * FROM app_credentials WHERE jti = $1")
            .bind(jti)
            .fetch_optional(executor)
            .await
    }

    pub async fn revoke_jti(
        executor: impl sqlx::SqliteExecutor<'_>,
        jti: &str,
    ) -> Result<(), sqlx::Error> {
        sqlx::query("UPDATE app_credentials SET revoked = 1 WHERE jti = $1")
            .bind(jti)
            .execute(executor)
            .await
            .map(|_| ())
    }

    pub async fn revoke_all_for_user(
        executor: impl sqlx::SqliteExecutor<'_>,
        user_id: i64,
    ) -> Result<(), sqlx::Error> {
        sqlx::query("UPDATE app_credentials SET revoked = 1 WHERE user_id = $1")
            .bind(user_id)
            .execute(executor)
            .await
            .map(|_| ())
    }
}
