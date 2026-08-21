use serde_json::json;
use std::sync::Arc;

use crate::common::TestServer;

async fn register_with_session(
    server: &TestServer,
    username: &str,
    email: Option<&str>,
) -> (Arc<reqwest::cookie::Jar>, i64) {
    let jar = Arc::new(reqwest::cookie::Jar::default());
    let client = reqwest::Client::builder()
        .cookie_provider(jar.clone())
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .unwrap();
    let mut form = vec![
        ("username", username.to_string()),
        ("password", "testpassword".to_string()),
        ("password_confirmation", "testpassword".to_string()),
    ];
    if let Some(email) = email {
        form.push(("email", email.to_string()));
    }
    let resp = client
        .post(format!("http://{}/register", server.addr))
        .form(&form)
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 303);
    let user_id: i64 = sqlx::query_scalar("SELECT id FROM users WHERE username = ?")
        .bind(username)
        .fetch_one(&server.pool)
        .await
        .unwrap();
    (jar, user_id)
}

async fn confirm(
    server: &TestServer,
    jar: &Arc<reqwest::cookie::Jar>,
    token: &str,
) -> reqwest::Response {
    reqwest::Client::builder()
        .cookie_provider(jar.clone())
        .build()
        .unwrap()
        .post(format!("http://{}/api/web/confirm-email", server.addr))
        .header("Accept", "application/json")
        .json(&json!({ "token": token }))
        .send()
        .await
        .unwrap()
}

#[tokio::test]
async fn register_with_email_pends_instead_of_setting() {
    let server = TestServer::start().await;
    let (_jar, user_id) =
        register_with_session(&server, "confirm-register-a", Some("pending@example.com")).await;

    let email: Option<String> = sqlx::query_scalar("SELECT email FROM users WHERE id = ?")
        .bind(user_id)
        .fetch_one(&server.pool)
        .await
        .unwrap();
    assert_eq!(email, None);
    let pending: Option<String> =
        sqlx::query_scalar("SELECT pending_email FROM users WHERE id = ?")
            .bind(user_id)
            .fetch_one(&server.pool)
            .await
            .unwrap();
    assert_eq!(pending.as_deref(), Some("pending@example.com"));
    let tokens: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM email_confirmations WHERE user_id = ?")
            .bind(user_id)
            .fetch_one(&server.pool)
            .await
            .unwrap();
    assert_eq!(tokens, 1);
}

#[tokio::test]
async fn confirm_email_success_and_single_use() {
    let server = TestServer::start().await;
    let (jar, user_id) = register_with_session(&server, "confirm-ok", None).await;
    let token =
        seki_web::services::email_confirmation::mint(&server.pool, user_id, "new@example.com")
            .await
            .unwrap();
    seki_web::models::user::User::set_pending_email(&server.pool, user_id, Some("new@example.com"))
        .await
        .unwrap();

    let resp = confirm(&server, &jar, &token).await;
    assert_eq!(resp.status(), 200);

    let email: Option<String> = sqlx::query_scalar("SELECT email FROM users WHERE id = ?")
        .bind(user_id)
        .fetch_one(&server.pool)
        .await
        .unwrap();
    assert_eq!(email.as_deref(), Some("new@example.com"));
    let pending: Option<String> =
        sqlx::query_scalar("SELECT pending_email FROM users WHERE id = ?")
            .bind(user_id)
            .fetch_one(&server.pool)
            .await
            .unwrap();
    assert_eq!(pending, None);

    // Single use: the token is consumed.
    let resp2 = confirm(&server, &jar, &token).await;
    assert_eq!(resp2.status(), 422);
}

#[tokio::test]
async fn confirm_email_session_mismatch_is_rejected_without_reveal() {
    let server = TestServer::start().await;
    let (jar_a, user_a) = register_with_session(&server, "confirm-mismatch-a", None).await;
    let token = seki_web::services::email_confirmation::mint(&server.pool, user_a, "a@example.com")
        .await
        .unwrap();
    seki_web::models::user::User::set_pending_email(&server.pool, user_a, Some("a@example.com"))
        .await
        .unwrap();
    let (jar_b, _user_b) = register_with_session(&server, "confirm-mismatch-b", None).await;

    let resp = confirm(&server, &jar_b, &token).await;
    assert_eq!(resp.status(), 403);
    let msg = resp.text().await.unwrap();
    assert!(
        !msg.contains("confirm-mismatch-a"),
        "must not reveal the token owner: {msg}"
    );

    // Not consumed: the right session can still confirm.
    let resp2 = confirm(&server, &jar_a, &token).await;
    assert_eq!(resp2.status(), 200);
}

#[tokio::test]
async fn confirm_email_expired_token_rejected() {
    let server = TestServer::start().await;
    let (jar, user_id) = register_with_session(&server, "confirm-expired", None).await;
    let token =
        seki_web::services::email_confirmation::mint(&server.pool, user_id, "x@example.com")
            .await
            .unwrap();
    sqlx::query(
        "UPDATE email_confirmations SET expires_at = '2020-01-01T00:00:00Z' WHERE user_id = ?",
    )
    .bind(user_id)
    .execute(&server.pool)
    .await
    .unwrap();

    let resp = confirm(&server, &jar, &token).await;
    assert_eq!(resp.status(), 422);
}

#[tokio::test]
async fn confirm_email_first_wins_on_shared_pending_address() {
    let server = TestServer::start().await;
    let (jar_a, user_a) = register_with_session(&server, "confirm-wins-a", None).await;
    let (jar_b, user_b) = register_with_session(&server, "confirm-wins-b", None).await;

    seki_web::models::user::User::set_pending_email(
        &server.pool,
        user_a,
        Some("shared@example.com"),
    )
    .await
    .unwrap();
    let token_a =
        seki_web::services::email_confirmation::mint(&server.pool, user_a, "shared@example.com")
            .await
            .unwrap();
    seki_web::models::user::User::set_pending_email(
        &server.pool,
        user_b,
        Some("shared@example.com"),
    )
    .await
    .unwrap();
    let token_b =
        seki_web::services::email_confirmation::mint(&server.pool, user_b, "shared@example.com")
            .await
            .unwrap();

    let resp = confirm(&server, &jar_a, &token_a).await;
    assert_eq!(resp.status(), 200);
    let resp2 = confirm(&server, &jar_b, &token_b).await;
    assert_eq!(resp2.status(), 422);
}
