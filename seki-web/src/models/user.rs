use chrono::{DateTime, Utc};
use rand::RngExt;
use sqlx::FromRow;

use crate::db::DbPool;

const ADJECTIVES: &[&str] = &[
    "bold", "calm", "clever", "swift", "keen", "bright", "gentle", "nimble", "quiet", "fierce",
    "wise", "brave", "noble", "steady", "agile", "deft", "glad", "proud", "lively", "merry",
    "witty", "daring", "eager", "hardy", "jolly", "placid", "shy", "stout", "vivid", "warm",
];

const NOUNS: &[&str] = &[
    "crane", "tiger", "dragon", "bear", "eagle", "fox", "hawk", "heron", "otter", "panda", "raven",
    "robin", "stone", "wolf", "badger", "cedar", "dove", "elm", "finch", "grove", "hare", "jade",
    "koi", "lark", "maple", "oak", "pine", "reed", "sage", "sparrow", "thorn", "wren",
];

fn generate_name() -> String {
    let mut rng = rand::rng();
    let adj = ADJECTIVES[rng.random_range(0..ADJECTIVES.len())];
    let noun = NOUNS[rng.random_range(0..NOUNS.len())];
    format!("{adj}-{noun}")
}

#[derive(Debug, Clone, FromRow)]
#[allow(dead_code)] // Fields populated by SELECT * via sqlx
pub struct User {
    pub id: i64,
    pub session_token: Option<String>,
    pub email: Option<String>,
    pub username: String,
    pub password_hash: Option<String>,
    pub api_token: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

impl User {
    pub async fn find_by_id(pool: &DbPool, id: i64) -> Result<User, sqlx::Error> {
        sqlx::query_as::<_, User>("SELECT * FROM users WHERE id = $1")
            .bind(id)
            .fetch_one(pool)
            .await
    }

    pub async fn find_by_ids(pool: &DbPool, ids: &[i64]) -> Result<Vec<User>, sqlx::Error> {
        // Use ANY($1) with a slice parameter for Postgres
        sqlx::query_as::<_, User>("SELECT * FROM users WHERE id = ANY($1)")
            .bind(ids)
            .fetch_all(pool)
            .await
    }

    pub async fn find_by_session_token(
        pool: &DbPool,
        token: &str,
    ) -> Result<Option<User>, sqlx::Error> {
        sqlx::query_as::<_, User>("SELECT * FROM users WHERE session_token = $1")
            .bind(token)
            .fetch_optional(pool)
            .await
    }

    pub async fn find_by_email(pool: &DbPool, email: &str) -> Result<Option<User>, sqlx::Error> {
        sqlx::query_as::<_, User>("SELECT * FROM users WHERE email = $1")
            .bind(email)
            .fetch_optional(pool)
            .await
    }

    pub async fn create(pool: &DbPool) -> Result<User, sqlx::Error> {
        let token = generate_token();
        // Retry with a new name on unique constraint violation
        loop {
            let name = generate_name();
            let result = sqlx::query_as::<_, User>(
                "INSERT INTO users (session_token, username) VALUES ($1, $2) RETURNING *",
            )
            .bind(&token)
            .bind(&name)
            .fetch_one(pool)
            .await;

            match result {
                Ok(user) => return Ok(user),
                Err(sqlx::Error::Database(e)) if e.is_unique_violation() => continue,
                Err(e) => return Err(e),
            }
        }
    }

    pub async fn find_or_create_by_email(
        pool: &DbPool,
        email: &str,
    ) -> Result<User, sqlx::Error> {
        if let Some(user) = Self::find_by_email(pool, email).await? {
            return Ok(user);
        }
        let name = generate_name();
        sqlx::query_as::<_, User>(
            "INSERT INTO users (email, username) VALUES ($1, $2) RETURNING *",
        )
        .bind(email)
        .bind(&name)
        .fetch_one(pool)
        .await
    }

    pub fn display_name(&self) -> &str {
        &self.username
    }

    pub fn is_registered(&self) -> bool {
        self.password_hash.is_some()
    }

    pub async fn find_by_username(
        pool: &DbPool,
        username: &str,
    ) -> Result<Option<User>, sqlx::Error> {
        sqlx::query_as::<_, User>("SELECT * FROM users WHERE username = $1")
            .bind(username)
            .fetch_optional(pool)
            .await
    }

    pub async fn set_credentials(
        pool: &DbPool,
        user_id: i64,
        username: &str,
        password_hash: &str,
    ) -> Result<User, sqlx::Error> {
        sqlx::query_as::<_, User>(
            "UPDATE users SET username = $1, password_hash = $2, updated_at = NOW() WHERE id = $3 RETURNING *",
        )
        .bind(username)
        .bind(password_hash)
        .bind(user_id)
        .fetch_one(pool)
        .await
    }

    pub async fn find_by_api_token(
        pool: &DbPool,
        token: &str,
    ) -> Result<Option<User>, sqlx::Error> {
        sqlx::query_as::<_, User>("SELECT * FROM users WHERE api_token = $1")
            .bind(token)
            .fetch_optional(pool)
            .await
    }

    pub async fn generate_api_token(pool: &DbPool, user_id: i64) -> Result<User, sqlx::Error> {
        let token = generate_token();
        sqlx::query_as::<_, User>(
            "UPDATE users SET api_token = $1, updated_at = NOW() WHERE id = $2 RETURNING *",
        )
        .bind(&token)
        .bind(user_id)
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
