use chrono::{DateTime, Utc};
use sqlx::FromRow;

#[derive(Debug, Clone, FromRow)]
#[allow(dead_code)]
pub struct PushDestination {
    pub id: i64,
    pub user_id: i64,
    pub endpoint: String,
    pub p256dh: String,
    pub auth: String,
    pub user_agent: Option<String>,
    pub enabled: bool,
    pub last_delivered_at: Option<String>,
    pub last_failure_at: Option<String>,
    pub failure_reason: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, FromRow)]
#[allow(dead_code)]
pub struct PushDestinationMeta {
    pub id: i64,
    pub user_agent: Option<String>,
    pub enabled: bool,
    pub last_delivered_at: Option<String>,
    pub last_failure_at: Option<String>,
    pub created_at: DateTime<Utc>,
}

impl PushDestination {
    pub async fn create(
        executor: impl sqlx::SqliteExecutor<'_>,
        user_id: i64,
        endpoint: &str,
        p256dh: &str,
        auth: &str,
        user_agent: Option<&str>,
    ) -> Result<PushDestination, sqlx::Error> {
        sqlx::query_as::<_, PushDestination>(
            "INSERT INTO push_destinations (user_id, endpoint, p256dh, auth, user_agent) VALUES ($1, $2, $3, $4, $5) RETURNING *",
        )
        .bind(user_id)
        .bind(endpoint)
        .bind(p256dh)
        .bind(auth)
        .bind(user_agent)
        .fetch_one(executor)
        .await
    }

    pub async fn find_by_user(
        executor: impl sqlx::SqliteExecutor<'_>,
        user_id: i64,
    ) -> Result<Vec<PushDestination>, sqlx::Error> {
        sqlx::query_as::<_, PushDestination>("SELECT * FROM push_destinations WHERE user_id = $1")
            .bind(user_id)
            .fetch_all(executor)
            .await
    }

    pub async fn find_meta_by_user(
        executor: impl sqlx::SqliteExecutor<'_>,
        user_id: i64,
    ) -> Result<Vec<PushDestinationMeta>, sqlx::Error> {
        sqlx::query_as::<_, PushDestinationMeta>(
            "SELECT id, user_agent, enabled, last_delivered_at, last_failure_at, created_at FROM push_destinations WHERE user_id = $1",
        )
        .bind(user_id)
        .fetch_all(executor)
        .await
    }

    pub async fn find_by_user_and_enabled(
        executor: impl sqlx::SqliteExecutor<'_>,
        user_id: i64,
    ) -> Result<Vec<PushDestination>, sqlx::Error> {
        sqlx::query_as::<_, PushDestination>(
            "SELECT * FROM push_destinations WHERE user_id = $1 AND enabled = 1",
        )
        .bind(user_id)
        .fetch_all(executor)
        .await
    }

    pub async fn find_by_endpoint(
        executor: impl sqlx::SqliteExecutor<'_>,
        endpoint: &str,
    ) -> Result<Option<PushDestination>, sqlx::Error> {
        sqlx::query_as::<_, PushDestination>("SELECT * FROM push_destinations WHERE endpoint = $1")
            .bind(endpoint)
            .fetch_optional(executor)
            .await
    }

    pub async fn update_keys(
        executor: impl sqlx::SqliteExecutor<'_>,
        id: i64,
        p256dh: &str,
        auth: &str,
    ) -> Result<(), sqlx::Error> {
        sqlx::query(
            "UPDATE push_destinations SET p256dh = $1, auth = $2, enabled = 1, updated_at = current_timestamp, last_failure_at = NULL, failure_reason = NULL WHERE id = $3",
        )
        .bind(p256dh)
        .bind(auth)
        .bind(id)
        .execute(executor)
        .await
        .map(|_| ())
    }

    pub async fn disable(
        executor: impl sqlx::SqliteExecutor<'_>,
        id: i64,
    ) -> Result<(), sqlx::Error> {
        sqlx::query("UPDATE push_destinations SET enabled = 0, updated_at = current_timestamp WHERE id = $1")
            .bind(id)
            .execute(executor)
            .await
            .map(|_| ())
    }

    pub async fn enable(
        executor: impl sqlx::SqliteExecutor<'_>,
        id: i64,
    ) -> Result<(), sqlx::Error> {
        sqlx::query(
            "UPDATE push_destinations SET enabled = 1, updated_at = current_timestamp WHERE id = $1",
        )
        .bind(id)
        .execute(executor)
        .await
        .map(|_| ())
    }

    pub async fn record_delivery(
        executor: impl sqlx::SqliteExecutor<'_>,
        id: i64,
    ) -> Result<(), sqlx::Error> {
        sqlx::query(
            "UPDATE push_destinations SET last_delivered_at = current_timestamp, last_failure_at = NULL, failure_reason = NULL, updated_at = current_timestamp WHERE id = $1",
        )
        .bind(id)
        .execute(executor)
        .await
        .map(|_| ())
    }

    pub async fn record_failure(
        executor: impl sqlx::SqliteExecutor<'_>,
        id: i64,
        reason: &str,
    ) -> Result<(), sqlx::Error> {
        sqlx::query(
            "UPDATE push_destinations SET last_failure_at = current_timestamp, failure_reason = $1, updated_at = current_timestamp WHERE id = $2",
        )
        .bind(reason)
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
            sqlx::query_as("SELECT COUNT(*) FROM push_destinations WHERE user_id = $1")
                .bind(user_id)
                .fetch_one(executor)
                .await?;
        Ok(row.0)
    }
}
