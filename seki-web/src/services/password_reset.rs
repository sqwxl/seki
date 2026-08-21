use argon2::password_hash::SaltString;
use argon2::password_hash::rand_core::OsRng;
use argon2::{Argon2, PasswordHasher};
use chrono::{Duration, Utc};

use crate::db::DbPool;
use crate::error::AppError;
use crate::models::user::User;
use crate::services::mailer::Mailer;
use crate::services::tokens::{generate_token, sha256_hex};

/// Reset links expire after this long; users can request a new one.
pub const TOKEN_TTL: Duration = Duration::minutes(60);

/// Sends a reset link if a registered user has this email. Always succeeds
/// from the caller's perspective — never reveals whether the email exists.
pub async fn request_reset(
    db: &DbPool,
    mailer: &Mailer,
    email: &str,
    base_url: &str,
) -> Result<(), AppError> {
    let email = crate::models::user::normalize_email(email);
    let Some(user) = User::find_by_email(db, &email).await? else {
        return Ok(());
    };

    let token = generate_token();
    let token_sha256 = sha256_hex(&token);
    let expires_at = (Utc::now() + TOKEN_TTL).to_rfc3339();

    // A new request invalidates previous outstanding ones.
    sqlx::query("DELETE FROM password_resets WHERE user_id = ? AND used_at IS NULL")
        .bind(user.id)
        .execute(db)
        .await?;
    sqlx::query("INSERT INTO password_resets (user_id, token_sha256, expires_at) VALUES (?, ?, ?)")
        .bind(user.id)
        .bind(&token_sha256)
        .bind(&expires_at)
        .execute(db)
        .await?;

    let reset_url = format!("{base_url}/reset-password?token={token}");
    mailer
        .send_password_reset(&email, &user.username, &reset_url)
        .await;

    Ok(())
}

/// Whether a token is currently valid (unused, unexpired). Does not consume it.
pub async fn token_info(db: &DbPool, token: &str) -> Result<Option<User>, AppError> {
    let Some((_, user_id)) = valid_token_row(db, token).await? else {
        return Ok(None);
    };
    Ok(Some(User::find_by_id(db, user_id).await?))
}

/// Consumes the token and sets the new password. Returns the user on success,
/// None if the token is invalid, expired, or already used.
pub async fn reset_password(
    db: &DbPool,
    token: &str,
    new_password: &str,
) -> Result<Option<User>, AppError> {
    let Some((row_id, user_id)) = valid_token_row(db, token).await? else {
        return Ok(None);
    };

    // Mark used; a concurrent request with the same token loses the race.
    let consumed = sqlx::query(
        "UPDATE password_resets SET used_at = CURRENT_TIMESTAMP \
         WHERE id = ? AND used_at IS NULL",
    )
    .bind(row_id)
    .execute(db)
    .await?;
    if consumed.rows_affected() == 0 {
        return Ok(None);
    }

    let salt = SaltString::generate(&mut OsRng);
    let password_hash = Argon2::default()
        .hash_password(new_password.as_bytes(), &salt)
        .map_err(|e| AppError::Internal(format!("Password hash error: {e}")))?
        .to_string();
    User::set_password(db, user_id, &password_hash).await?;

    Ok(Some(User::find_by_id(db, user_id).await?))
}

/// Finds the (row id, user id) of a currently valid token via its sha256.
async fn valid_token_row(db: &DbPool, token: &str) -> Result<Option<(i64, i64)>, AppError> {
    let row = sqlx::query_as::<_, (i64, i64)>(
        "SELECT id, user_id FROM password_resets \
         WHERE token_sha256 = ? AND used_at IS NULL AND expires_at > CURRENT_TIMESTAMP",
    )
    .bind(sha256_hex(token))
    .fetch_optional(db)
    .await?;
    Ok(row)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn token_sha256_is_deterministic() {
        assert_eq!(sha256_hex("abc"), sha256_hex("abc"));
        assert_ne!(sha256_hex("abc"), sha256_hex("abd"));
    }
}
