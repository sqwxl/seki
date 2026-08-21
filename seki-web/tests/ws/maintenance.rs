use crate::common::TestServer;

async fn stale_anon_user(server: &TestServer, username: &str) -> i64 {
    sqlx::query_scalar(
        "INSERT INTO users (username, session_token, created_at) \
         VALUES (?, ?, datetime('now', '-60 days')) RETURNING id",
    )
    .bind(username)
    .bind(format!("session-{username}"))
    .fetch_one(&server.pool)
    .await
    .unwrap()
}

#[tokio::test]
async fn maintenance_purges_used_and_expired_tokens() {
    let server = TestServer::start().await;
    let game_id = server.create_and_join().await;
    let user_id: i64 = sqlx::query_scalar("SELECT id FROM users WHERE username = 'test-black'")
        .fetch_one(&server.pool)
        .await
        .unwrap();
    // A live, unused token must survive.
    sqlx::query(
        "INSERT INTO game_challenge_tokens (game_id, user_id, token_sha256, expires_at) \
         VALUES (?, ?, 'live', datetime('now', '+1 day'))",
    )
    .bind(game_id)
    .bind(user_id)
    .execute(&server.pool)
    .await
    .unwrap();
    // Used + expired tokens must go.
    sqlx::query(
        "INSERT INTO game_challenge_tokens (game_id, user_id, token_sha256, expires_at, used_at) \
         VALUES (?, ?, 'used', datetime('now', '+1 day'), CURRENT_TIMESTAMP)",
    )
    .bind(game_id)
    .bind(user_id)
    .execute(&server.pool)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO game_challenge_tokens (game_id, user_id, token_sha256, expires_at) \
         VALUES (?, ?, 'expired', datetime('now', '-1 day'))",
    )
    .bind(game_id)
    .bind(user_id)
    .execute(&server.pool)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO password_resets (user_id, token_sha256, expires_at, used_at) \
         VALUES (?, 'old-reset', datetime('now', '-1 day'), CURRENT_TIMESTAMP)",
    )
    .bind(user_id)
    .execute(&server.pool)
    .await
    .unwrap();

    seki_web::services::maintenance::sweep(&server.pool)
        .await
        .unwrap();

    let remaining: Vec<String> =
        sqlx::query_scalar("SELECT token_sha256 FROM game_challenge_tokens")
            .fetch_all(&server.pool)
            .await
            .unwrap();
    assert_eq!(remaining, vec!["live".to_string()]);
    let resets: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM password_resets")
        .fetch_one(&server.pool)
        .await
        .unwrap();
    assert_eq!(resets, 0);
}

#[tokio::test]
async fn maintenance_purges_stale_anonymous_users_but_keeps_active_ones() {
    let server = TestServer::start().await;
    // Stale anon: 60 days old, no games/messages.
    let stale = stale_anon_user(&server, "stale-anon").await;
    // A game_reads row should be cleaned along with the user.
    let game_id = server.create_and_join().await;
    sqlx::query("INSERT INTO game_reads (game_id, user_id, last_seen_move_count) VALUES (?, ?, 0)")
        .bind(game_id)
        .bind(stale)
        .execute(&server.pool)
        .await
        .unwrap();
    // Recent anon: kept (age cutoff).
    let recent = stale_anon_user(&server, "recent-anon").await;
    sqlx::query("UPDATE users SET created_at = CURRENT_TIMESTAMP WHERE id = ?")
        .bind(recent)
        .execute(&server.pool)
        .await
        .unwrap();
    // Anon with a message: kept.
    let messaged = stale_anon_user(&server, "messaged-anon").await;
    sqlx::query("INSERT INTO messages (game_id, user_id, text) VALUES (?, ?, 'hi')")
        .bind(game_id)
        .bind(messaged)
        .execute(&server.pool)
        .await
        .unwrap();
    // Anon with a game: kept.
    let gameful = stale_anon_user(&server, "gameful-anon").await;
    sqlx::query(
        "INSERT INTO games (cols, rows, komi, handicap, is_private, allow_undo, access_token, \
         stage, black_id, white_id, creator_id, time_control, ranked, rating_range_mode) \
         VALUES (9, 9, 6.5, 0, 0, 1, 'x', 'black_to_play', ?, ?, ?, 'none', 0, 'unlimited')",
    )
    .bind(gameful)
    .bind(gameful)
    .bind(gameful)
    .execute(&server.pool)
    .await
    .unwrap();
    // Registered user, even if unused: kept.
    let _registered = stale_anon_user(&server, "stale-registered").await;
    sqlx::query("UPDATE users SET password_hash = 'x' WHERE username = 'stale-registered'")
        .execute(&server.pool)
        .await
        .unwrap();

    seki_web::services::maintenance::sweep(&server.pool)
        .await
        .unwrap();

    let remaining: Vec<String> = sqlx::query_scalar(
        "SELECT username FROM users WHERE username IN ('stale-anon','recent-anon','messaged-anon','gameful-anon','stale-registered')",
    )
    .fetch_all(&server.pool)
    .await
    .unwrap();
    assert_eq!(
        remaining,
        vec![
            "gameful-anon".to_string(),
            "messaged-anon".to_string(),
            "recent-anon".to_string(),
            "stale-registered".to_string(),
        ]
    );
    let game_reads: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM game_reads WHERE user_id = ?")
        .bind(stale)
        .fetch_one(&server.pool)
        .await
        .unwrap();
    assert_eq!(game_reads, 0);
}
