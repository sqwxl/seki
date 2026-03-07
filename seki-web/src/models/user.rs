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
    pub preferences: serde_json::Value,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

impl User {
    pub async fn find_by_id(
        executor: impl sqlx::PgExecutor<'_>,
        id: i64,
    ) -> Result<User, sqlx::Error> {
        sqlx::query_as::<_, User>("SELECT * FROM users WHERE id = $1")
            .bind(id)
            .fetch_one(executor)
            .await
    }

    pub async fn find_by_ids(
        executor: impl sqlx::PgExecutor<'_>,
        ids: &[i64],
    ) -> Result<Vec<User>, sqlx::Error> {
        // Use ANY($1) with a slice parameter for Postgres
        sqlx::query_as::<_, User>("SELECT * FROM users WHERE id = ANY($1)")
            .bind(ids)
            .fetch_all(executor)
            .await
    }

    pub async fn find_by_session_token(
        executor: impl sqlx::PgExecutor<'_>,
        token: &str,
    ) -> Result<Option<User>, sqlx::Error> {
        sqlx::query_as::<_, User>("SELECT * FROM users WHERE session_token = $1")
            .bind(token)
            .fetch_optional(executor)
            .await
    }

    pub async fn find_by_email(
        executor: impl sqlx::PgExecutor<'_>,
        email: &str,
    ) -> Result<Option<User>, sqlx::Error> {
        sqlx::query_as::<_, User>("SELECT * FROM users WHERE email = $1")
            .bind(email)
            .fetch_optional(executor)
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

    pub async fn find_or_create_by_email(pool: &DbPool, email: &str) -> Result<User, sqlx::Error> {
        if let Some(user) = Self::find_by_email(pool, email).await? {
            return Ok(user);
        }
        let name = generate_name();
        sqlx::query_as::<_, User>("INSERT INTO users (email, username) VALUES ($1, $2) RETURNING *")
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
        executor: impl sqlx::PgExecutor<'_>,
        username: &str,
    ) -> Result<Option<User>, sqlx::Error> {
        sqlx::query_as::<_, User>("SELECT * FROM users WHERE username = $1")
            .bind(username)
            .fetch_optional(executor)
            .await
    }

    pub async fn set_credentials(
        executor: impl sqlx::PgExecutor<'_>,
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
        .fetch_one(executor)
        .await
    }

    pub async fn update_username(
        executor: impl sqlx::PgExecutor<'_>,
        user_id: i64,
        username: &str,
    ) -> Result<User, sqlx::Error> {
        sqlx::query_as::<_, User>(
            "UPDATE users SET username = $1, updated_at = NOW() WHERE id = $2 RETURNING *",
        )
        .bind(username)
        .bind(user_id)
        .fetch_one(executor)
        .await
    }

    pub async fn find_by_api_token(
        executor: impl sqlx::PgExecutor<'_>,
        token: &str,
    ) -> Result<Option<User>, sqlx::Error> {
        sqlx::query_as::<_, User>("SELECT * FROM users WHERE api_token = $1")
            .bind(token)
            .fetch_optional(executor)
            .await
    }

    pub async fn update_preferences(
        executor: impl sqlx::PgExecutor<'_>,
        user_id: i64,
        preferences: &serde_json::Value,
    ) -> Result<User, sqlx::Error> {
        sqlx::query_as::<_, User>(
            "UPDATE users SET preferences = preferences || $1, updated_at = NOW() WHERE id = $2 RETURNING *",
        )
        .bind(preferences)
        .bind(user_id)
        .fetch_one(executor)
        .await
    }

    /// Search users by prefix, sorted: recent opponents first, then last active.
    pub async fn search_by_prefix(
        pool: &crate::db::DbPool,
        prefix: &str,
        current_user_id: i64,
        limit: i64,
    ) -> Result<Vec<UserSearchRow>, sqlx::Error> {
        let pattern = format!("{prefix}%");
        sqlx::query_as::<_, UserSearchRow>(
            "SELECT u.*, (g.opponent_id IS NOT NULL) AS is_recent \
             FROM users u \
             LEFT JOIN ( \
                 SELECT CASE WHEN black_id = $1 THEN white_id ELSE black_id END AS opponent_id, \
                        MAX(updated_at) AS last_played \
                 FROM games \
                 WHERE (black_id = $1 OR white_id = $1) \
                 AND black_id IS NOT NULL AND white_id IS NOT NULL \
                 GROUP BY opponent_id \
             ) g ON u.id = g.opponent_id \
             WHERE u.id != $1 AND u.username ILIKE $2 \
             ORDER BY (g.opponent_id IS NOT NULL) DESC, \
                      COALESCE(g.last_played, u.updated_at) DESC \
             LIMIT $3",
        )
        .bind(current_user_id)
        .bind(&pattern)
        .bind(limit)
        .fetch_all(pool)
        .await
    }

    /// List users sorted: recent opponents first, then last active.
    pub async fn list_for_challenge(
        pool: &crate::db::DbPool,
        current_user_id: i64,
        limit: i64,
    ) -> Result<Vec<UserSearchRow>, sqlx::Error> {
        sqlx::query_as::<_, UserSearchRow>(
            "SELECT u.*, (g.opponent_id IS NOT NULL) AS is_recent \
             FROM users u \
             LEFT JOIN ( \
                 SELECT CASE WHEN black_id = $1 THEN white_id ELSE black_id END AS opponent_id, \
                        MAX(updated_at) AS last_played \
                 FROM games \
                 WHERE (black_id = $1 OR white_id = $1) \
                 AND black_id IS NOT NULL AND white_id IS NOT NULL \
                 GROUP BY opponent_id \
             ) g ON u.id = g.opponent_id \
             WHERE u.id != $1 \
             ORDER BY (g.opponent_id IS NOT NULL) DESC, \
                      COALESCE(g.last_played, u.updated_at) DESC \
             LIMIT $2",
        )
        .bind(current_user_id)
        .bind(limit)
        .fetch_all(pool)
        .await
    }

    pub async fn generate_api_token(
        executor: impl sqlx::PgExecutor<'_>,
        user_id: i64,
    ) -> Result<User, sqlx::Error> {
        let token = generate_token();
        sqlx::query_as::<_, User>(
            "UPDATE users SET api_token = $1, updated_at = NOW() WHERE id = $2 RETURNING *",
        )
        .bind(&token)
        .bind(user_id)
        .fetch_one(executor)
        .await
    }
}

#[derive(Debug, Clone, FromRow)]
#[allow(dead_code)]
pub struct UserSearchRow {
    pub id: i64,
    pub session_token: Option<String>,
    pub email: Option<String>,
    pub username: String,
    pub password_hash: Option<String>,
    pub api_token: Option<String>,
    pub preferences: serde_json::Value,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub is_recent: bool,
}

impl UserSearchRow {
    pub fn is_registered(&self) -> bool {
        self.password_hash.is_some()
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
