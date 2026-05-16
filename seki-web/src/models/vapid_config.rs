use chrono::{DateTime, Utc};
use sqlx::FromRow;

#[derive(Debug, Clone, FromRow)]
#[allow(dead_code)]
pub struct VapidKeyRow {
    pub id: i64,
    pub private_key: String,
    pub public_key: String,
    pub subject: Option<String>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Default)]
pub struct VapidKeys {
    pub private_key: String,
    pub public_key: String,
    pub subject: Option<String>,
}

pub async fn load_or_generate(
    executor: impl sqlx::SqliteExecutor<'_>,
) -> Result<VapidKeys, sqlx::Error> {
    if let Ok(private_key) = std::env::var("VAPID_PRIVATE_KEY")
        && let Ok(public_key) = std::env::var("VAPID_PUBLIC_KEY")
    {
        return Ok(VapidKeys {
            private_key,
            public_key,
            subject: std::env::var("VAPID_SUBJECT").ok(),
        });
    }

    let existing = sqlx::query_as::<_, VapidKeyRow>(
        "SELECT * FROM vapid_config ORDER BY created_at DESC LIMIT 1",
    )
    .fetch_optional(executor)
    .await?;

    if let Some(row) = existing {
        return Ok(VapidKeys {
            private_key: row.private_key,
            public_key: row.public_key,
            subject: row.subject,
        });
    }

    Ok(VapidKeys {
        private_key: String::new(),
        public_key: String::new(),
        subject: None,
    })
}

pub async fn store_keys(
    executor: impl sqlx::SqliteExecutor<'_>,
    private_key: &str,
    public_key: &str,
    subject: Option<&str>,
) -> Result<(), sqlx::Error> {
    sqlx::query("INSERT INTO vapid_config (private_key, public_key, subject) VALUES ($1, $2, $3)")
        .bind(private_key)
        .bind(public_key)
        .bind(subject)
        .execute(executor)
        .await
        .map(|_| ())
}
