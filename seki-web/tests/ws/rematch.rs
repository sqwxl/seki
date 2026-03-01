use serde_json::json;

use crate::common::TestServer;

/// Play one move so the game is considered "started" by the engine.
async fn play_one_move(ts: &TestServer, game_id: i64) {
    let resp = ts
        .client_black
        .post(format!("http://{}/api/games/{game_id}/play", ts.addr))
        .header("Authorization", "Bearer test-black-api-token-12345")
        .json(&json!({"col": 0, "row": 0}))
        .send()
        .await
        .unwrap();
    assert!(resp.status().is_success(), "play failed: {}", resp.status());
}

/// Resign the game as black via API.
async fn resign_as_black(ts: &TestServer, game_id: i64) {
    let resp = ts
        .client_black
        .post(format!("http://{}/api/games/{game_id}/resign", ts.addr))
        .header("Authorization", "Bearer test-black-api-token-12345")
        .send()
        .await
        .unwrap();
    let status = resp.status();
    let body = resp.text().await.unwrap();
    assert!(
        status.is_success(),
        "resign failed: {} — body: {}",
        status,
        body
    );
}

/// Rematch after resignation creates a new game with same settings.
#[tokio::test]
async fn rematch_creates_new_game() {
    let ts = TestServer::start().await;
    let game_id = ts.create_and_join().await;

    play_one_move(&ts, game_id).await;
    resign_as_black(&ts, game_id).await;

    // Rematch via API — black requests rematch, no swap
    let resp = ts
        .client_black
        .post(format!("http://{}/api/games/{game_id}/rematch", ts.addr))
        .header("Authorization", "Bearer test-black-api-token-12345")
        .json(&json!({}))
        .send()
        .await
        .unwrap();
    let status = resp.status();
    let resp_body = resp.text().await.unwrap();
    assert!(
        status.is_success(),
        "rematch failed: {} — body: {}",
        status,
        resp_body
    );
    let body: serde_json::Value = serde_json::from_str(&resp_body).unwrap();
    let new_id = body["id"].as_i64().expect("new game id");
    assert_ne!(new_id, game_id);
    assert_eq!(body["cols"].as_i64().unwrap(), 9);
    assert_eq!(body["rows"].as_i64().unwrap(), 9);

    // Black should still be black (no swap)
    assert_eq!(body["black"]["username"].as_str().unwrap(), "test-black");
    assert_eq!(body["white"]["username"].as_str().unwrap(), "test-white");
}

/// Rematch with swap_colors swaps player colors.
#[tokio::test]
async fn rematch_swap_colors() {
    let ts = TestServer::start().await;
    let game_id = ts.create_and_join().await;

    play_one_move(&ts, game_id).await;
    resign_as_black(&ts, game_id).await;

    // Rematch with swap
    let resp = ts
        .client_black
        .post(format!("http://{}/api/games/{game_id}/rematch", ts.addr))
        .header("Authorization", "Bearer test-black-api-token-12345")
        .json(&json!({"swap_colors": true}))
        .send()
        .await
        .unwrap();
    let status = resp.status();
    let resp_body = resp.text().await.unwrap();
    assert!(
        status.is_success(),
        "rematch failed: {} — body: {}",
        status,
        resp_body
    );
    let body: serde_json::Value = serde_json::from_str(&resp_body).unwrap();

    // Black should now be white and vice versa
    assert_eq!(body["white"]["username"].as_str().unwrap(), "test-black");
    assert_eq!(body["black"]["username"].as_str().unwrap(), "test-white");
}
