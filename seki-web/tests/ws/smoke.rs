use crate::common::TestServer;

#[tokio::test]
async fn spa_shell_without_session_does_not_create_anonymous_user() {
    let server = TestServer::start().await;
    let client = reqwest::Client::builder()
        .cookie_store(true)
        .build()
        .unwrap();
    let before: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM users")
        .fetch_one(&server.pool)
        .await
        .unwrap();

    let response = client
        .get(format!("http://{}/games", server.addr))
        .send()
        .await
        .unwrap();

    assert!(response.status().is_success());
    let after: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM users")
        .fetch_one(&server.pool)
        .await
        .unwrap();
    assert_eq!(after, before);
}

#[tokio::test]
async fn auth_token_without_session_bootstraps_anonymous_user() {
    let server = TestServer::start().await;
    let client = reqwest::Client::builder()
        .cookie_store(true)
        .build()
        .unwrap();
    let before: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM users")
        .fetch_one(&server.pool)
        .await
        .unwrap();

    let response = client
        .get(format!("http://{}/api/auth/token", server.addr))
        .header("Accept", "application/json")
        .send()
        .await
        .unwrap();

    assert!(response.status().is_success());
    let body: serde_json::Value = response.json().await.unwrap();
    assert!(
        body["token"]
            .as_str()
            .is_some_and(|token| !token.is_empty())
    );
    assert_eq!(body["user"]["is_registered"], false);

    let after: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM users")
        .fetch_one(&server.pool)
        .await
        .unwrap();
    assert_eq!(after, before + 1);
}

#[tokio::test]
async fn smoke_ws_connect_and_join() {
    let server = TestServer::start().await;
    let game_id = server.create_and_join().await;

    let mut black = server.ws_black().await;

    // First message on connect is init
    let init = black.recv_kind("init").await;
    assert_eq!(init["kind"], "init");

    // Join the game room and receive full game state
    let state = black.join_game(game_id).await;
    assert_eq!(state["kind"], "state_sync");
    assert_eq!(state["stage"], "black_to_play");
}
