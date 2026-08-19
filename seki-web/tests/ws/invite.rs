use std::sync::Arc;

use serde_json::json;

use crate::common::TestServer;

/// Logs a fresh cookie jar into the challengee's session via the invite link.
/// Returns the jar (with session cookie).
async fn login_via_invite(server: &TestServer, link: &str) -> Arc<reqwest::cookie::Jar> {
    let jar = Arc::new(reqwest::cookie::Jar::default());
    let client = reqwest::Client::builder()
        .cookie_provider(jar.clone())
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .unwrap();
    let resp = client
        .get(format!("http://{}{}", server.addr, link))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 303);
    jar
}

/// Creates an email-invite game via the API as test-black and returns
/// (game id, invite link). The opponent's identity is resolved at mint time.
async fn create_email_invite(server: &TestServer, email: &str, is_private: bool) -> (i64, String) {
    let mut body = json!({
        "cols": 9,
        "invite_email": email,
        "komi": 6.5,
        "handicap": 0,
        "color": "black",
    });
    if is_private {
        body["is_private"] = json!(true);
    }
    let resp = server
        .client_black
        .post(format!("http://{}/api/games", server.addr))
        .header("Authorization", "Bearer test-black-api-token-12345")
        .json(&body)
        .send()
        .await
        .unwrap();
    assert!(
        resp.status().is_success(),
        "create failed: {}",
        resp.status()
    );
    let body: serde_json::Value = resp.json().await.unwrap();
    assert!(
        body["opponent"].is_object(),
        "opponent seat should be populated at mint time"
    );
    assert_eq!(body["stage"], "challenge");
    let game_id = body["id"].as_i64().unwrap();
    let link = body["invite_link"].as_str().unwrap().to_string();
    (game_id, link)
}

fn fresh_client() -> reqwest::Client {
    reqwest::Client::builder()
        .cookie_store(true)
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .unwrap()
}

#[tokio::test]
async fn email_invite_mints_anon_challengee_and_link_logs_in_once() {
    let server = TestServer::start().await;
    let (game_id, link) = create_email_invite(&server, "invitee@example.com", false).await;
    let before: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM users")
        .fetch_one(&server.pool)
        .await
        .unwrap();

    // A fresh visitor follows the link and is logged into the challengee.
    let client = fresh_client();
    let resp = client
        .get(format!("http://{}{}", server.addr, link))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 303);
    assert_eq!(
        resp.headers().get("location").unwrap().to_str().unwrap(),
        format!("/games/{game_id}")
    );

    // No new user at click time — the challengee was minted with the email.
    let after: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM users")
        .fetch_one(&server.pool)
        .await
        .unwrap();
    assert_eq!(after, before);

    let me = client
        .get(format!("http://{}/api/session/me", server.addr))
        .header("Accept", "application/json")
        .send()
        .await
        .unwrap();
    assert!(me.status().is_success());
    let me_body: serde_json::Value = me.json().await.unwrap();
    assert_eq!(me_body["email"], "invitee@example.com");
    assert_eq!(me_body["is_registered"], false);

    // Single use: a second visitor gets a dead link.
    let client2 = fresh_client();
    let resp2 = client2
        .get(format!("http://{}{}", server.addr, link))
        .send()
        .await
        .unwrap();
    assert_eq!(resp2.status(), 303);
    assert_eq!(
        resp2.headers().get("location").unwrap().to_str().unwrap(),
        "/"
    );
}

#[tokio::test]
async fn email_invite_to_registered_user_redirects_to_login() {
    let server = TestServer::start().await;
    sqlx::query("UPDATE users SET email = 'registered@example.com' WHERE username = 'test-white'")
        .execute(&server.pool)
        .await
        .unwrap();
    let (game_id, link) = create_email_invite(&server, "registered@example.com", false).await;

    // Logged-out visitor is sent to login; the game is theirs once signed in.
    let client = fresh_client();
    let resp = client
        .get(format!("http://{}{}", server.addr, link))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 303);
    assert_eq!(
        resp.headers().get("location").unwrap().to_str().unwrap(),
        format!("/login?redirect=/games/{game_id}")
    );

    // The signed-in challengee goes straight to the game.
    let resp2 = server
        .client_white
        .get(format!("http://{}{}", server.addr, link))
        .send()
        .await
        .unwrap();
    assert_eq!(resp2.status(), 303);
    assert_eq!(
        resp2.headers().get("location").unwrap().to_str().unwrap(),
        format!("/games/{game_id}")
    );
}

#[tokio::test]
async fn non_pristine_anon_clicking_invite_is_refused() {
    let server = TestServer::start().await;
    let (game_id, link) = create_email_invite(&server, "invitee@example.com", false).await;

    // Anonymous user with history: has an api token and a game of their own.
    let client = fresh_client();
    let resp = client
        .get(format!("http://{}/api/auth/token", server.addr))
        .header("Accept", "application/json")
        .send()
        .await
        .unwrap();
    assert!(resp.status().is_success());
    let created = client
        .post(format!("http://{}/games", server.addr))
        .form(&[("cols", "9")])
        .send()
        .await
        .unwrap();
    assert!(
        created.status().is_redirection(),
        "form create should redirect to the game, got {}",
        created.status()
    );

    // Clicking the invite refuses to swap identities; public game → view it.
    let resp = client
        .get(format!("http://{}{}", server.addr, link))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 303);
    assert_eq!(
        resp.headers().get("location").unwrap().to_str().unwrap(),
        format!("/games/{game_id}")
    );

    // Still the same anonymous user, not the challengee.
    let me = client
        .get(format!("http://{}/api/session/me", server.addr))
        .header("Accept", "application/json")
        .send()
        .await
        .unwrap();
    let me_body: serde_json::Value = me.json().await.unwrap();
    assert_eq!(me_body["email"], serde_json::Value::Null);
}

#[tokio::test]
async fn non_pristine_anon_clicking_private_invite_lands_home() {
    let server = TestServer::start().await;
    let (_game_id, link) = create_email_invite(&server, "invitee@example.com", true).await;

    let client = fresh_client();
    let resp = client
        .get(format!("http://{}/api/auth/token", server.addr))
        .header("Accept", "application/json")
        .send()
        .await
        .unwrap();
    assert!(resp.status().is_success());
    let created = client
        .post(format!("http://{}/games", server.addr))
        .form(&[("cols", "9")])
        .send()
        .await
        .unwrap();
    assert!(
        created.status().is_redirection(),
        "form create should redirect to the game, got {}",
        created.status()
    );

    // Private game: the visitor can't even view it, so land on the home page.
    let resp = client
        .get(format!("http://{}{}", server.addr, link))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 303);
    assert_eq!(
        resp.headers().get("location").unwrap().to_str().unwrap(),
        "/"
    );
}

#[tokio::test]
async fn email_invite_rejects_creators_own_email() {
    let server = TestServer::start().await;
    sqlx::query("UPDATE users SET email = 'creator@example.com' WHERE username = 'test-black'")
        .execute(&server.pool)
        .await
        .unwrap();

    let resp = server
        .client_black
        .post(format!("http://{}/api/games", server.addr))
        .header("Authorization", "Bearer test-black-api-token-12345")
        .json(&json!({
            "cols": 9,
            "invite_email": "creator@example.com",
            "komi": 6.5,
            "handicap": 0,
            "color": "black",
        }))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 422);
}

#[tokio::test]
async fn email_invite_rejects_invalid_email() {
    let server = TestServer::start().await;
    let resp = server
        .client_black
        .post(format!("http://{}/api/games", server.addr))
        .header("Authorization", "Bearer test-black-api-token-12345")
        .json(&json!({
            "cols": 9,
            "invite_email": "not-an-email",
            "komi": 6.5,
            "handicap": 0,
            "color": "black",
        }))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 422);
}

#[tokio::test]
async fn expired_token_is_rejected() {
    let server = TestServer::start().await;
    let (_game_id, link) = create_email_invite(&server, "invitee@example.com", false).await;
    let token = link.trim_start_matches("/invite/");
    sqlx::query("UPDATE game_challenge_tokens SET expires_at = '2020-01-01T00:00:00Z' WHERE token_sha256 IS NOT NULL")
        .execute(&server.pool)
        .await
        .unwrap();
    let _ = token;

    let client = fresh_client();
    let resp = client
        .get(format!("http://{}{}", server.addr, link))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 303);
    assert_eq!(
        resp.headers().get("location").unwrap().to_str().unwrap(),
        "/"
    );
}

#[tokio::test]
async fn different_registered_user_is_sent_to_login() {
    let server = TestServer::start().await;
    sqlx::query("UPDATE users SET email = 'registered@example.com' WHERE username = 'test-white'")
        .execute(&server.pool)
        .await
        .unwrap();
    let (game_id, link) = create_email_invite(&server, "registered@example.com", false).await;

    // test-black is registered and is NOT the challengee (test-white is).
    let resp = server
        .client_black
        .get(format!("http://{}{}", server.addr, link))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 303);
    assert_eq!(
        resp.headers().get("location").unwrap().to_str().unwrap(),
        format!("/login?redirect=/games/{game_id}")
    );
}

#[tokio::test]
async fn anon_challengee_can_register_with_invite_email() {
    let server = TestServer::start().await;
    let (_game_id, link) = create_email_invite(&server, "invitee@example.com", false).await;

    // Follow the link: the fresh visitor becomes the anonymous challengee.
    let jar = login_via_invite(&server, &link).await;
    let client = reqwest::Client::builder()
        .cookie_provider(jar)
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .unwrap();

    // Registering with the invite email upgrades that same user in place.
    let resp = client
        .post(format!("http://{}/register", server.addr))
        .form(&[
            ("username", "invitee"),
            ("password", "testpassword"),
            ("password_confirmation", "testpassword"),
            ("email", "invitee@example.com"),
        ])
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 303);

    let me = client
        .get(format!("http://{}/api/session/me", server.addr))
        .header("Accept", "application/json")
        .send()
        .await
        .unwrap();
    assert!(me.status().is_success());
    let me_body: serde_json::Value = me.json().await.unwrap();
    assert_eq!(me_body["display_name"], "invitee");
    assert_eq!(me_body["email"], "invitee@example.com");
    assert_eq!(me_body["is_registered"], true);
}

#[tokio::test]
async fn invite_email_is_normalized_to_lowercase() {
    let server = TestServer::start().await;
    let before: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM users")
        .fetch_one(&server.pool)
        .await
        .unwrap();

    // Mixed-case invite mints one lowercase user…
    let (_game_id, _link) = create_email_invite(&server, "Invitee@Example.COM", false).await;
    let emails: Vec<String> =
        sqlx::query_scalar("SELECT email FROM users WHERE email = 'invitee@example.com'")
            .fetch_all(&server.pool)
            .await
            .unwrap();
    assert_eq!(emails, vec!["invitee@example.com".to_string()]);

    // …and a differently-cased invite to the same address reuses that user.
    let (_game_id2, _link2) = create_email_invite(&server, "invitee@example.com", false).await;
    let after: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM users")
        .fetch_one(&server.pool)
        .await
        .unwrap();
    assert_eq!(after, before + 1);
}

#[tokio::test]
async fn anon_challengee_can_decline_via_ws() {
    let server = TestServer::start().await;
    let (game_id, link) = create_email_invite(&server, "invitee@example.com", false).await;
    let jar = login_via_invite(&server, &link).await;

    let mut ws = server.ws_connect(&jar).await;
    ws.join_game(game_id).await;
    ws.send(json!({"action": "decline_challenge", "game_id": game_id}))
        .await;
    // The handler applies the action asynchronously; wait for the broadcast.
    ws.recv_kind("state").await;

    let (stage, result): (String, String) =
        sqlx::query_as("SELECT stage, result FROM games WHERE id = $1")
            .bind(game_id)
            .fetch_one(&server.pool)
            .await
            .unwrap();
    assert_eq!(stage, "declined");
    assert_eq!(result, "Declined");
}

#[tokio::test]
async fn anon_challengee_accepts_nigiri_invite_via_ws() {
    let server = TestServer::start().await;
    let body = json!({
        "cols": 9,
        "invite_email": "invitee@example.com",
        "komi": 6.5,
        "handicap": 0,
        "color": "random",
    });
    let resp = server
        .client_black
        .post(format!("http://{}/api/games", server.addr))
        .header("Authorization", "Bearer test-black-api-token-12345")
        .json(&body)
        .send()
        .await
        .unwrap();
    assert!(
        resp.status().is_success(),
        "create failed: {}",
        resp.status()
    );
    let body: serde_json::Value = resp.json().await.unwrap();
    let game_id = body["id"].as_i64().unwrap();
    let link = body["invite_link"].as_str().unwrap().to_string();
    let jar = login_via_invite(&server, &link).await;

    let mut ws = server.ws_connect(&jar).await;
    ws.join_game(game_id).await;
    ws.send(json!({"action": "accept_challenge", "game_id": game_id}))
        .await;
    // The handler applies the action asynchronously; wait for the broadcast.
    ws.recv_kind("state").await;

    let (stage, black_id, white_id): (String, Option<i64>, Option<i64>) =
        sqlx::query_as("SELECT stage, black_id, white_id FROM games WHERE id = $1")
            .bind(game_id)
            .fetch_one(&server.pool)
            .await
            .unwrap();
    assert_eq!(stage, "black_to_play");
    assert!(black_id.is_some() && white_id.is_some());
    assert_ne!(black_id, white_id);
}

#[tokio::test]
async fn registered_challengee_with_non_pristine_anon_visitor_redirects_to_login() {
    let server = TestServer::start().await;
    sqlx::query("UPDATE users SET email = 'registered@example.com' WHERE username = 'test-white'")
        .execute(&server.pool)
        .await
        .unwrap();
    let (game_id, link) = create_email_invite(&server, "registered@example.com", false).await;

    // Anonymous visitor with history (api token + a game of their own).
    let client = fresh_client();
    let resp = client
        .get(format!("http://{}/api/auth/token", server.addr))
        .header("Accept", "application/json")
        .send()
        .await
        .unwrap();
    assert!(resp.status().is_success());
    let created = client
        .post(format!("http://{}/games", server.addr))
        .form(&[("cols", "9")])
        .send()
        .await
        .unwrap();
    assert!(created.status().is_redirection());

    // Even with session history, a registered challengee's invite funnels to
    // login — there is no session swap to protect against.
    let resp = client
        .get(format!("http://{}{}", server.addr, link))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 303);
    assert_eq!(
        resp.headers().get("location").unwrap().to_str().unwrap(),
        format!("/login?redirect=/games/{game_id}")
    );
}

#[tokio::test]
async fn push_skips_visible_destinations_when_app_connected() {
    use seki_web::services::push::{PushPayload, PushService};

    let server = TestServer::start().await;
    let user_id: i64 = sqlx::query_scalar("SELECT id FROM users WHERE username = 'test-white'")
        .fetch_one(&server.pool)
        .await
        .unwrap();
    // Dummy endpoint: any real send attempt fails and records a failure.
    sqlx::query(
        "INSERT INTO push_destinations (user_id, endpoint, p256dh, auth, enabled, visible) \
         VALUES (?, 'https://push.example/endpoint', 'x', 'y', 1, 0)",
    )
    .bind(user_id)
    .execute(&server.pool)
    .await
    .unwrap();
    let dest_id: i64 = sqlx::query_scalar("SELECT id FROM push_destinations WHERE user_id = ?")
        .bind(user_id)
        .fetch_one(&server.pool)
        .await
        .unwrap();

    // Zero-key VAPID builder — never actually sends, only exercises the skip.
    let service = PushService::new("I0sBANCQIfhO_8BFUyocVk7QOdzUHLfg3NJhYTVfe0E").unwrap();
    let payload = PushPayload {
        title: "t".into(),
        body: None,
        icon: None,
        badge: None,
        data: None,
    };

    // Visible + connected: destination is skipped, nothing is attempted.
    sqlx::query("UPDATE push_destinations SET visible = 1 WHERE id = ?")
        .bind(dest_id)
        .execute(&server.pool)
        .await
        .unwrap();
    service
        .send_to_user(&server.pool, user_id, &payload, true)
        .await
        .unwrap();
    let failures: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM push_destinations WHERE id = ? AND last_failure_at IS NOT NULL",
    )
    .bind(dest_id)
    .fetch_one(&server.pool)
    .await
    .unwrap();
    assert_eq!(failures, 0);

    // Not visible: the send is attempted and fails against the dummy endpoint.
    sqlx::query("UPDATE push_destinations SET visible = 0 WHERE id = ?")
        .bind(dest_id)
        .execute(&server.pool)
        .await
        .unwrap();
    let _ = service
        .send_to_user(&server.pool, user_id, &payload, true)
        .await;
    let failures: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM push_destinations WHERE id = ? AND last_failure_at IS NOT NULL",
    )
    .bind(dest_id)
    .fetch_one(&server.pool)
    .await
    .unwrap();
    assert_eq!(failures, 1);
}
