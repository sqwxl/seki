use chrono::{DateTime, Utc};
use rand::RngExt;
use sqlx::FromRow;

use crate::db::DbPool;

#[derive(Debug, Clone, FromRow)]
#[allow(dead_code)] // Fields populated by SELECT * via sqlx
pub struct Player {
    pub id: i64,
    pub session_token: Option<String>,
    pub email: Option<String>,
    pub username: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

impl Player {
    pub async fn find_by_id(pool: &DbPool, id: i64) -> Result<Player, sqlx::Error> {
        sqlx::query_as::<_, Player>("SELECT * FROM players WHERE id = $1")
            .bind(id)
            .fetch_one(pool)
            .await
    }

    pub async fn find_by_session_token(
        pool: &DbPool,
        token: &str,
    ) -> Result<Option<Player>, sqlx::Error> {
        sqlx::query_as::<_, Player>("SELECT * FROM players WHERE session_token = $1")
            .bind(token)
            .fetch_optional(pool)
            .await
    }

    pub async fn find_by_email(
        pool: &DbPool,
        email: &str,
    ) -> Result<Option<Player>, sqlx::Error> {
        sqlx::query_as::<_, Player>("SELECT * FROM players WHERE email = $1")
            .bind(email)
            .fetch_optional(pool)
            .await
    }

    pub async fn create(pool: &DbPool) -> Result<Player, sqlx::Error> {
        let token = generate_token();
        sqlx::query_as::<_, Player>(
            "INSERT INTO players (session_token) VALUES ($1) RETURNING *",
        )
        .bind(&token)
        .fetch_one(pool)
        .await
    }

    pub async fn find_or_create_by_email(
        pool: &DbPool,
        email: &str,
    ) -> Result<Player, sqlx::Error> {
        if let Some(player) = Self::find_by_email(pool, email).await? {
            return Ok(player);
        }
        sqlx::query_as::<_, Player>(
            "INSERT INTO players (email) VALUES ($1) RETURNING *",
        )
        .bind(email)
        .fetch_one(pool)
        .await
    }

    pub fn display_name(&self) -> &str {
        self.username.as_deref().unwrap_or("Anonymous")
    }
}

fn generate_token() -> String {
    let mut rng = rand::rng();
    (0..22)
        .map(|_| {
            let idx = rng.random_range(0..62);
            b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"[idx] as char
        })
        .collect()
}
