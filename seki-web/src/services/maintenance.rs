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
    purge_expired_tokens(db).await?;
    purge_stale_anonymous_users(db).await?;
    Ok(())
}

/// Used or expired tokens can never be used again; drop them so the token
/// tables stay bounded. Revoked app credentials are kept for audit.
async fn purge_expired_tokens(db: &DbPool) -> Result<(), sqlx::Error> {
    for table in [
        "game_challenge_tokens",
        "email_confirmations",
        "password_resets",
    ] {
        sqlx::query(&format!(
            "DELETE FROM {table} WHERE used_at IS NOT NULL OR expires_at < CURRENT_TIMESTAMP"
        ))
        .execute(db)
        .await?;
    }
    sqlx::query("DELETE FROM app_credentials WHERE expires_at < CURRENT_TIMESTAMP")
        .execute(db)
        .await?;
    sqlx::query("DELETE FROM tower_sessions WHERE expiry_date < CURRENT_TIMESTAMP")
        .execute(db)
        .await?;
    Ok(())
}

/// Anonymous accounts older than 30 days with no game or chat history are
/// throwaway identities (auto-generated names, no password) — nothing worth
/// losing, and they accumulate from abandoned invites and sessions.
async fn purge_stale_anonymous_users(db: &DbPool) -> Result<(), sqlx::Error> {
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
        return Ok(());
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

    tracing::info!(
        "Maintenance: purged {} stale anonymous accounts",
        candidates.len()
    );
    Ok(())
}
