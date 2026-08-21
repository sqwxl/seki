use chrono::{Duration, Utc};

use crate::db::DbPool;
use crate::error::AppError;
use crate::models::user::User;
use crate::services::mailer::Mailer;
use crate::services::tokens::{generate_token, sha256_hex};

/// Confirmation links expire after this long.
pub const TOKEN_TTL: Duration = Duration::hours(24);

/// Pends a user-submitted email and sends the confirmation link. The current
/// confirmed email stays live until the new one is confirmed.
pub async fn request(
    db: &DbPool,
    mailer: &Mailer,
    user_id: i64,
    email: &str,
    base_url: &str,
) -> Result<(), AppError> {
    User::set_pending_email(db, user_id, Some(email)).await?;
    let token = mint(db, user_id, email).await?;
    mailer
        .send_email_confirmation(email, &token, base_url)
        .await;
    Ok(())
}

/// Clears the pending email and any outstanding confirmation tokens.
pub async fn clear(db: &DbPool, user_id: i64) -> Result<(), AppError> {
    User::set_pending_email(db, user_id, None).await?;
    sqlx::query("DELETE FROM email_confirmations WHERE user_id = ?")
        .bind(user_id)
        .execute(db)
        .await?;
    Ok(())
}

/// Mints a one-time confirmation token for a user + email, replacing any
/// outstanding one. Returns the raw token — the DB stores only its sha256.
pub async fn mint(db: &DbPool, user_id: i64, email: &str) -> Result<String, AppError> {
    sqlx::query("DELETE FROM email_confirmations WHERE user_id = ?")
        .bind(user_id)
        .execute(db)
        .await?;
    let token = generate_token();
    let token_sha256 = sha256_hex(&token);
    let expires_at = (Utc::now() + TOKEN_TTL).to_rfc3339();
    sqlx::query(
        "INSERT INTO email_confirmations (user_id, email, token_sha256, expires_at) \
         VALUES (?, ?, ?, ?)",
    )
    .bind(user_id)
    .bind(email)
    .bind(&token_sha256)
    .bind(&expires_at)
    .execute(db)
    .await?;
    Ok(token)
}

/// Resolve a currently valid (unused, unexpired) token to its row, user, and
/// email. Returns None for unknown, expired, or consumed tokens.
pub async fn resolve(db: &DbPool, token: &str) -> Result<Option<(i64, i64, String)>, AppError> {
    let row = sqlx::query_as::<_, (i64, i64, String)>(
        "SELECT id, user_id, email FROM email_confirmations \
         WHERE token_sha256 = ? AND used_at IS NULL AND expires_at > CURRENT_TIMESTAMP",
    )
    .bind(sha256_hex(token))
    .fetch_optional(db)
    .await?;
    Ok(row)
}

pub async fn consume(db: &DbPool, row_id: i64) -> Result<bool, AppError> {
    let result = sqlx::query(
        "UPDATE email_confirmations SET used_at = CURRENT_TIMESTAMP \
         WHERE id = ? AND used_at IS NULL",
    )
    .bind(row_id)
    .execute(db)
    .await?;
    Ok(result.rows_affected() == 1)
}
