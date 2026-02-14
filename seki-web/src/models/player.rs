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
    pub password_hash: Option<String>,
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

    pub async fn find_by_ids(pool: &DbPool, ids: &[i64]) -> Result<Vec<Player>, sqlx::Error> {
        // Use ANY($1) with a slice parameter for Postgres
        sqlx::query_as::<_, Player>("SELECT * FROM players WHERE id = ANY($1)")
            .bind(ids)
            .fetch_all(pool)
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

    pub async fn find_by_email(pool: &DbPool, email: &str) -> Result<Option<Player>, sqlx::Error> {
        sqlx::query_as::<_, Player>("SELECT * FROM players WHERE email = $1")
            .bind(email)
            .fetch_optional(pool)
            .await
    }

    pub async fn create(pool: &DbPool) -> Result<Player, sqlx::Error> {
        let token = generate_token();
        sqlx::query_as::<_, Player>("INSERT INTO players (session_token) VALUES ($1) RETURNING *")
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
        sqlx::query_as::<_, Player>("INSERT INTO players (email) VALUES ($1) RETURNING *")
            .bind(email)
            .fetch_one(pool)
            .await
    }

    pub fn display_name(&self) -> &str {
        self.username.as_deref().unwrap_or("Anonymous")
    }

    pub fn is_registered(&self) -> bool {
        self.username.is_some()
    }

    pub async fn find_by_username(
        pool: &DbPool,
        username: &str,
    ) -> Result<Option<Player>, sqlx::Error> {
        sqlx::query_as::<_, Player>("SELECT * FROM players WHERE username = $1")
            .bind(username)
            .fetch_optional(pool)
            .await
    }

    pub async fn set_credentials(
        pool: &DbPool,
        player_id: i64,
        username: &str,
        password_hash: &str,
    ) -> Result<Player, sqlx::Error> {
        sqlx::query_as::<_, Player>(
            "UPDATE players SET username = $1, password_hash = $2, updated_at = NOW() WHERE id = $3 RETURNING *",
        )
        .bind(username)
        .bind(password_hash)
        .bind(player_id)
        .fetch_one(pool)
        .await
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
