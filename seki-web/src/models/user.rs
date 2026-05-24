use chrono::{DateTime, Utc};
use rand::RngExt;
use sqlx::FromRow;
use sqlx::QueryBuilder;
use sqlx::Sqlite;

use crate::db::DbPool;

const DEFAULT_RATING_DISPLAY: &str = "kyu_dan";

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
    pub is_bot: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

impl User {
    pub async fn find_by_id(
        executor: impl sqlx::SqliteExecutor<'_>,
        id: i64,
    ) -> Result<User, sqlx::Error> {
        sqlx::query_as::<_, User>("SELECT * FROM users WHERE id = $1")
            .bind(id)
            .fetch_one(executor)
            .await
    }

    pub async fn find_by_ids(
        executor: impl sqlx::SqliteExecutor<'_>,
        ids: &[i64],
    ) -> Result<Vec<User>, sqlx::Error> {
        if ids.is_empty() {
            return Ok(Vec::new());
        }

        let mut query = QueryBuilder::<Sqlite>::new("SELECT * FROM users WHERE id IN (");
        let mut separated = query.separated(", ");
        for id in ids {
            separated.push_bind(id);
        }
        separated.push_unseparated(")");

        query.build_query_as::<User>().fetch_all(executor).await
    }

    pub async fn find_by_session_token(
        executor: impl sqlx::SqliteExecutor<'_>,
        token: &str,
    ) -> Result<Option<User>, sqlx::Error> {
        sqlx::query_as::<_, User>("SELECT * FROM users WHERE session_token = $1")
            .bind(token)
            .fetch_optional(executor)
            .await
    }

    pub async fn find_by_email(
        executor: impl sqlx::SqliteExecutor<'_>,
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

    pub fn rating_display_preference(&self) -> &'static str {
        match self
            .preferences
            .get("rating_display")
            .and_then(|value| value.as_str())
        {
            Some("rating") => "rating",
            _ => DEFAULT_RATING_DISPLAY,
        }
    }

    pub fn preferences_with_defaults(&self) -> serde_json::Value {
        let mut preferences = self.preferences.clone();
        if !preferences.is_object() {
            preferences = serde_json::json!({});
        }
        preferences["rating_display"] = self.rating_display_preference().into();
        preferences
    }

    pub async fn find_by_username(
        executor: impl sqlx::SqliteExecutor<'_>,
        username: &str,
    ) -> Result<Option<User>, sqlx::Error> {
        sqlx::query_as::<_, User>("SELECT * FROM users WHERE username = $1")
            .bind(username)
            .fetch_optional(executor)
            .await
    }

    pub async fn set_credentials(
        executor: impl sqlx::SqliteExecutor<'_>,
        user_id: i64,
        username: &str,
        password_hash: &str,
        is_bot: bool,
    ) -> Result<User, sqlx::Error> {
        sqlx::query_as::<_, User>(
            "UPDATE users SET username = $1, password_hash = $2, is_bot = $4, updated_at = CURRENT_TIMESTAMP WHERE id = $3 RETURNING *",
        )
        .bind(username)
        .bind(password_hash)
        .bind(user_id)
        .bind(is_bot)
        .fetch_one(executor)
        .await
    }

    pub async fn update_username(
        executor: impl sqlx::SqliteExecutor<'_>,
        user_id: i64,
        username: &str,
    ) -> Result<User, sqlx::Error> {
        sqlx::query_as::<_, User>(
            "UPDATE users SET username = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING *",
        )
        .bind(username)
        .bind(user_id)
        .fetch_one(executor)
        .await
    }

    pub async fn find_by_api_token(
        executor: impl sqlx::SqliteExecutor<'_>,
        token: &str,
    ) -> Result<Option<User>, sqlx::Error> {
        sqlx::query_as::<_, User>("SELECT * FROM users WHERE api_token = $1")
            .bind(token)
            .fetch_optional(executor)
            .await
    }

    pub async fn update_preferences(
        pool: &DbPool,
        user_id: i64,
        preferences: &serde_json::Value,
    ) -> Result<User, sqlx::Error> {
        let mut user = Self::find_by_id(pool, user_id).await?;
        merge_json(&mut user.preferences, preferences);

        sqlx::query_as::<_, User>(
            "UPDATE users SET preferences = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING *",
        )
        .bind(&user.preferences)
        .bind(user_id)
        .fetch_one(pool)
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
             WHERE u.id != $1 AND u.username LIKE $2 COLLATE NOCASE \
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

    pub async fn list_eligible_opponents(
        pool: &crate::db::DbPool,
        current_user_id: i64,
        rated_only: bool,
    ) -> Result<Vec<User>, sqlx::Error> {
        if rated_only {
            sqlx::query_as::<_, User>(
                "SELECT u.* FROM users u \
                 JOIN rating_profiles rp ON u.id = rp.user_id \
                 WHERE u.id != $1 \
                 AND rp.participating = 1 \
                 ORDER BY u.updated_at DESC \
                 LIMIT 50",
            )
            .bind(current_user_id)
            .fetch_all(pool)
            .await
        } else {
            sqlx::query_as::<_, User>(
                "SELECT * FROM users WHERE id != $1 ORDER BY updated_at DESC LIMIT 50",
            )
            .bind(current_user_id)
            .fetch_all(pool)
            .await
        }
    }

    pub async fn update_email(
        executor: impl sqlx::SqliteExecutor<'_>,
        user_id: i64,
        email: &str,
    ) -> Result<User, sqlx::Error> {
        sqlx::query_as::<_, User>(
            "UPDATE users SET email = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING *",
        )
        .bind(email)
        .bind(user_id)
        .fetch_one(executor)
        .await
    }

    pub async fn generate_api_token(
        executor: impl sqlx::SqliteExecutor<'_>,
        user_id: i64,
    ) -> Result<User, sqlx::Error> {
        let token = generate_token();
        sqlx::query_as::<_, User>(
            "UPDATE users SET api_token = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING *",
        )
        .bind(&token)
        .bind(user_id)
        .fetch_one(executor)
        .await
    }

    /// Dev-only: find or auto-create a user for `random-bot-{N}` tokens.
    /// Gated behind `#[cfg(debug_assertions)]` — always returns None in release builds.
    pub async fn find_or_create_dev_bot(
        pool: &DbPool,
        token: &str,
    ) -> Result<Option<User>, sqlx::Error> {
        if cfg!(not(debug_assertions)) {
            return Ok(None);
        }
        if !token.starts_with("random-bot-") {
            return Ok(None);
        }

        if let Some(user) = Self::find_by_api_token(pool, token).await? {
            return Ok(Some(user));
        }

        sqlx::query_as::<_, User>(
            "INSERT INTO users (username, api_token, password_hash) VALUES ($1, $2, $3) RETURNING *",
        )
        .bind(token)
        .bind(token)
        .bind("auto-created-dev-bot")
        .fetch_optional(pool)
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
    pub is_bot: bool,
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

fn merge_json(target: &mut serde_json::Value, patch: &serde_json::Value) {
    match (target, patch) {
        (serde_json::Value::Object(target_map), serde_json::Value::Object(patch_map)) => {
            for (key, value) in patch_map {
                match target_map.get_mut(key) {
                    Some(existing) => merge_json(existing, value),
                    None => {
                        target_map.insert(key.clone(), value.clone());
                    }
                }
            }
        }
        (target_value, patch_value) => *target_value = patch_value.clone(),
    }
}
