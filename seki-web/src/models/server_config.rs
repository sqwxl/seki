use sqlx::FromRow;

#[derive(Debug, Clone, FromRow)]
struct ConfigRow {
    pub value: String,
}

const JWT_SECRET_KEY: &str = "app_credential_secret";

pub async fn load_jwt_secret(
    executor: impl sqlx::SqliteExecutor<'_>,
) -> Result<Option<String>, sqlx::Error> {
    let row = sqlx::query_as::<_, ConfigRow>("SELECT value FROM server_config WHERE key = ?")
        .bind(JWT_SECRET_KEY)
        .fetch_optional(executor)
        .await?;

    Ok(row.map(|r| r.value))
}

pub async fn store_jwt_secret(
    executor: impl sqlx::SqliteExecutor<'_>,
    secret: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO server_config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    )
    .bind(JWT_SECRET_KEY)
    .bind(secret)
    .execute(executor)
    .await
    .map(|_| ())
}
