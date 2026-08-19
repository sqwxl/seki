use chrono::{Duration, Utc};
use sha2::{Digest, Sha256};

use crate::db::DbPool;
use crate::error::AppError;
use crate::services::tokens::generate_token;

/// Challenge tokens are single-use logins for email-invited opponents.
/// Long TTL: invites can sit in an inbox for weeks. Low risk: consumed on
/// first use, and the account stays anonymous until the invitee registers.
pub const TOKEN_TTL: Duration = Duration::days(30);

fn sha256_hex(input: &str) -> String {
    let digest = Sha256::digest(input.as_bytes());
    digest.iter().map(|b| format!("{b:02x}")).collect()
}

/// Mint a one-time login token bound to a game + challengee. Returns the raw
/// token — the only copy; the DB stores only its sha256.
pub async fn mint(db: &DbPool, game_id: i64, user_id: i64) -> Result<String, AppError> {
    let token = generate_token();
    let token_sha256 = sha256_hex(&token);
    let expires_at = (Utc::now() + TOKEN_TTL).to_rfc3339();
    sqlx::query(
        "INSERT INTO game_challenge_tokens (game_id, user_id, token_sha256, expires_at) \
         VALUES (?, ?, ?, ?)",
    )
    .bind(game_id)
    .bind(user_id)
    .bind(&token_sha256)
    .bind(&expires_at)
    .execute(db)
    .await?;
    Ok(token)
}

/// Resolve a currently valid (unused, unexpired) token to its row, game, and
/// challengee. Returns None for unknown, expired, or consumed tokens.
pub async fn resolve(db: &DbPool, token: &str) -> Result<Option<(i64, i64, i64)>, AppError> {
    let Some((id, game_id, user_id)) = sqlx::query_as::<_, (i64, i64, i64)>(
        "SELECT id, game_id, user_id FROM game_challenge_tokens \
         WHERE token_sha256 = ? AND used_at IS NULL AND expires_at > CURRENT_TIMESTAMP",
    )
    .bind(sha256_hex(token))
    .fetch_optional(db)
    .await?
    else {
        return Ok(None);
    };
    Ok(Some((id, game_id, user_id)))
}

pub async fn consume(db: &DbPool, row_id: i64) -> Result<bool, AppError> {
    let result = sqlx::query(
        "UPDATE game_challenge_tokens SET used_at = CURRENT_TIMESTAMP \
         WHERE id = ? AND used_at IS NULL",
    )
    .bind(row_id)
    .execute(db)
    .await?;
    Ok(result.rows_affected() == 1)
}
