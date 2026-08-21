use std::time::Duration;

use crate::db::DbPool;

/// Periodic housekeeping: purge used/expired tokens and stale anonymous
/// accounts. Runs once at startup, then daily.
pub async fn run(db: DbPool) {
    let mut interval = tokio::time::interval(Duration::from_secs(24 * 3600));
    loop {
        interval.tick().await;
        if let Err(e) = sweep(&db).await {
            tracing::error!("Maintenance sweep error: {e}");
        }
    }
}

pub async fn sweep(db: &DbPool) -> Result<(), Box<dyn std::error::Error>> {
    let tokens_purged = purge_expired_tokens(db).await?;
    let anons_purged = purge_stale_anonymous_users(db).await?;
    if tokens_purged + anons_purged > 0 {
        tracing::info!(
            "Maintenance sweep: purged {tokens_purged} tokens, {anons_purged} stale anonymous accounts"
        );
    }
    Ok(())
}

/// Used or expired tokens can never be used again; drop them so the token
/// tables stay bounded. Revoked app credentials are kept for audit.
async fn purge_expired_tokens(db: &DbPool) -> Result<i64, sqlx::Error> {
    let mut purged = 0;
    for table in [
        "game_challenge_tokens",
        "email_confirmations",
        "password_resets",
    ] {
        let result = sqlx::query(&format!(
            "DELETE FROM {table} WHERE used_at IS NOT NULL OR expires_at < CURRENT_TIMESTAMP"
        ))
        .execute(db)
        .await?;
        purged += result.rows_affected() as i64;
    }
    for table in ["app_credentials", "tower_sessions"] {
        let result = sqlx::query(&format!(
            "DELETE FROM {table} WHERE {} < CURRENT_TIMESTAMP",
            if table == "app_credentials" {
                "expires_at"
            } else {
                "expiry_date"
            }
        ))
        .execute(db)
        .await?;
        purged += result.rows_affected() as i64;
    }
    Ok(purged)
}

/// Anonymous accounts older than 30 days with no game or chat history are
/// throwaway identities (auto-generated names, no password) — nothing worth
/// losing, and they accumulate from abandoned invites and sessions.
async fn purge_stale_anonymous_users(db: &DbPool) -> Result<i64, sqlx::Error> {
    let candidates: Vec<i64> = sqlx::query_scalar(
        "SELECT u.id FROM users u \
         WHERE u.password_hash IS NULL \
         AND u.created_at < datetime('now', '-30 days') \
         AND NOT EXISTS (SELECT 1 FROM games g \
             WHERE g.black_id = u.id OR g.white_id = u.id \
             OR g.creator_id = u.id OR g.opponent_id = u.id) \
         AND NOT EXISTS (SELECT 1 FROM messages m WHERE m.user_id = u.id)",
    )
    .fetch_all(db)
    .await?;

    if candidates.is_empty() {
        return Ok(0);
    }

    let mut tx = db.begin().await?;
    for id in &candidates {
        // game_reads has no cascade; device/rating tables do.
        sqlx::query("DELETE FROM game_reads WHERE user_id = ?")
            .bind(id)
            .execute(&mut *tx)
            .await?;
        sqlx::query("DELETE FROM users WHERE id = ?")
            .bind(id)
            .execute(&mut *tx)
            .await?;
    }
    tx.commit().await?;

    Ok(candidates.len() as i64)
}
