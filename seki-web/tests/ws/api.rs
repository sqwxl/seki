use serde_json::{Value, json};

use crate::common::TestServer;

// ============================================================
// Public Endpoints
// ============================================================

#[tokio::test]
async fn list_games_returns_public_games() {
    let server = TestServer::start().await;

    // No games yet
    let resp = server
        .client_black
        .get(format!("http://{}/api/games", server.addr))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);
    let body: Vec<Value> = resp.json().await.unwrap();
    assert!(body.is_empty());

    // Create a game
    server.create_game().await;

    let resp = server
        .client_black
        .get(format!("http://{}/api/games", server.addr))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);
    let body: Vec<Value> = resp.json().await.unwrap();
    assert!(!body.is_empty());
}

#[tokio::test]
async fn list_games_no_auth_required() {
    let server = TestServer::start().await;

    // No auth header at all
    let resp = reqwest::Client::new()
        .get(format!("http://{}/api/games", server.addr))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);
}

#[tokio::test]
async fn get_game_returns_game_state() {
    let server = TestServer::start().await;
    let game_id = server.create_game().await;

    let resp = server
        .client_black
        .get(format!("http://{}/api/games/{game_id}", server.addr))
        .header("Authorization", "Bearer test-black-api-token-12345")
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);
    let body: Value = resp.json().await.unwrap();
    assert_eq!(body["id"], game_id);
    assert_eq!(body["cols"], 9);
    assert_eq!(body["rows"], 9);
    assert!(body["state"].is_object());
}

#[tokio::test]
async fn get_game_no_auth_for_public_game() {
    let server = TestServer::start().await;
    let game_id = server.create_game().await;

    let resp = reqwest::Client::new()
        .get(format!("http://{}/api/games/{game_id}", server.addr))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);
}

#[tokio::test]
async fn get_game_404_for_nonexistent() {
    let server = TestServer::start().await;

    let resp = server
        .client_black
        .get(format!("http://{}/api/games/99999", server.addr))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 404);
    let body: Value = resp.json().await.unwrap();
    assert!(body["error"].is_string());
}

#[tokio::test]
async fn get_messages_returns_empty_initially() {
    let server = TestServer::start().await;
    let game_id = server.create_game().await;

    let resp = server
        .client_black
        .get(format!(
            "http://{}/api/games/{game_id}/messages",
            server.addr
        ))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);
    let body: Vec<Value> = resp.json().await.unwrap();
    assert!(body.is_empty());
}

#[tokio::test]
async fn get_messages_404_for_nonexistent_game() {
    let server = TestServer::start().await;

    let resp = server
        .client_black
        .get(format!("http://{}/api/games/99999/messages", server.addr))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 404);
}

#[tokio::test]
async fn get_turns_returns_empty_initially() {
    let server = TestServer::start().await;
    let game_id = server.create_game().await;

    let resp = server
        .client_black
        .get(format!("http://{}/api/games/{game_id}/turns", server.addr))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);
    let body: Vec<Value> = resp.json().await.unwrap();
    assert!(body.is_empty());
}

#[tokio::test]
async fn get_turns_404_for_nonexistent_game() {
    let server = TestServer::start().await;

    let resp = server
        .client_black
        .get(format!("http://{}/api/games/99999/turns", server.addr))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 404);
}

#[tokio::test]
async fn get_user_returns_profile() {
    let server = TestServer::start().await;

    let resp = server
        .client_black
        .get(format!("http://{}/api/users/test-black", server.addr))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);
    let body: Value = resp.json().await.unwrap();
    assert_eq!(body["username"], "test-black");
    assert_eq!(body["is_registered"], true);
}

#[tokio::test]
async fn get_user_404_for_nonexistent() {
    let server = TestServer::start().await;

    let resp = server
        .client_black
        .get(format!("http://{}/api/users/nonexistent-user", server.addr))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 404);
    let body: Value = resp.json().await.unwrap();
    assert!(body["error"].is_string());
}

#[tokio::test]
async fn get_user_games_returns_list() {
    let server = TestServer::start().await;

    // No games yet
    let resp = server
        .client_black
        .get(format!("http://{}/api/users/test-black/games", server.addr))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);
    let body: Vec<Value> = resp.json().await.unwrap();
    assert!(body.is_empty());

    // Create a game
    server.create_game().await;

    let resp = server
        .client_black
        .get(format!("http://{}/api/users/test-black/games", server.addr))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);
    let body: Vec<Value> = resp.json().await.unwrap();
    assert_eq!(body.len(), 1);
}

#[tokio::test]
async fn get_user_games_404_for_nonexistent_user() {
    let server = TestServer::start().await;

    let resp = server
        .client_black
        .get(format!(
            "http://{}/api/users/nonexistent-user/games",
            server.addr
        ))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 404);
}

// ============================================================
// Authenticated Endpoints
// ============================================================

#[tokio::test]
async fn get_me_returns_current_user() {
    let server = TestServer::start().await;

    let resp = server
        .client_black
        .get(format!("http://{}/api/me", server.addr))
        .header("Authorization", "Bearer test-black-api-token-12345")
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);
    let body: Value = resp.json().await.unwrap();
    assert_eq!(body["username"], "test-black");
    assert_eq!(body["is_registered"], true);
}

#[tokio::test]
async fn create_game_via_api() {
    let server = TestServer::start().await;

    let resp = server
        .client_black
        .post(format!("http://{}/api/games", server.addr))
        .header("Authorization", "Bearer test-black-api-token-12345")
        .json(&json!({"cols": 9, "rows": 9, "color": "black"}))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 201, "create_game should return 201 Created");
    let body: Value = resp.json().await.unwrap();
    assert!(body["id"].is_i64());
    assert_eq!(body["cols"], 9);
    assert_eq!(body["rows"], 9);
    assert!(body["black"].is_object());
}

#[tokio::test]
async fn delete_unstarted_game() {
    let server = TestServer::start().await;
    let game_id = server.create_game().await;

    let resp = server
        .client_black
        .delete(format!("http://{}/api/games/{game_id}", server.addr))
        .header("Authorization", "Bearer test-black-api-token-12345")
        .send()
        .await
        .unwrap();
    assert!(resp.status().is_success());
    let body: Value = resp.json().await.unwrap();
    assert_eq!(body["deleted"], true);

    // Verify game is gone
    let resp = server
        .client_black
        .get(format!("http://{}/api/games/{game_id}", server.addr))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 404);
}

#[tokio::test]
async fn delete_game_only_by_creator() {
    let server = TestServer::start().await;
    let game_id = server.create_game().await;

    // White (not creator) tries to delete
    let resp = server
        .client_white
        .delete(format!("http://{}/api/games/{game_id}", server.addr))
        .header("Authorization", "Bearer test-white-api-token-67890")
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 422);
}

#[tokio::test]
async fn delete_started_game_fails() {
    let server = TestServer::start().await;
    let game_id = server.create_and_join().await;

    // Play a move so the game is started (started_at is set on first move)
    server
        .client_black
        .post(format!("http://{}/api/games/{game_id}/play", server.addr))
        .header("Authorization", "Bearer test-black-api-token-12345")
        .json(&json!({"col": 0, "row": 0}))
        .send()
        .await
        .unwrap();

    let resp = server
        .client_black
        .delete(format!("http://{}/api/games/{game_id}", server.addr))
        .header("Authorization", "Bearer test-black-api-token-12345")
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 422);
    let body: Value = resp.json().await.unwrap();
    assert!(body["error"].as_str().unwrap().contains("started"));
}

#[tokio::test]
async fn join_game_via_api() {
    let server = TestServer::start().await;
    let game_id = server.create_game().await;

    let resp = server
        .client_white
        .post(format!("http://{}/api/games/{game_id}/join", server.addr))
        .header("Authorization", "Bearer test-white-api-token-67890")
        .json(&json!({}))
        .send()
        .await
        .unwrap();
    assert!(resp.status().is_success());
    let body: Value = resp.json().await.unwrap();
    assert!(body["white"].is_object());
    assert_eq!(body["white"]["username"], "test-white");
}

#[tokio::test]
async fn play_move_via_api() {
    let server = TestServer::start().await;
    let game_id = server.create_and_join().await;

    // Black plays first move
    let resp = server
        .client_black
        .post(format!("http://{}/api/games/{game_id}/play", server.addr))
        .header("Authorization", "Bearer test-black-api-token-12345")
        .json(&json!({"col": 2, "row": 2}))
        .send()
        .await
        .unwrap();
    assert!(resp.status().is_success());
    let body: Value = resp.json().await.unwrap();
    assert!(body["state"].is_object());
}

#[tokio::test]
async fn pass_via_api() {
    let server = TestServer::start().await;
    let game_id = server.create_and_join().await;

    let resp = server
        .client_black
        .post(format!("http://{}/api/games/{game_id}/pass", server.addr))
        .header("Authorization", "Bearer test-black-api-token-12345")
        .send()
        .await
        .unwrap();
    assert!(resp.status().is_success());
}

#[tokio::test]
async fn resign_via_api() {
    let server = TestServer::start().await;
    let game_id = server.create_and_join().await;

    // Play a move first (can't resign before first move)
    server
        .client_black
        .post(format!("http://{}/api/games/{game_id}/play", server.addr))
        .header("Authorization", "Bearer test-black-api-token-12345")
        .json(&json!({"col": 0, "row": 0}))
        .send()
        .await
        .unwrap();

    let resp = server
        .client_black
        .post(format!("http://{}/api/games/{game_id}/resign", server.addr))
        .header("Authorization", "Bearer test-black-api-token-12345")
        .send()
        .await
        .unwrap();
    assert!(resp.status().is_success());
    let body: Value = resp.json().await.unwrap();
    assert!(body["result"].is_string());
}

#[tokio::test]
async fn abort_via_api() {
    let server = TestServer::start().await;
    let game_id = server.create_game().await;

    let resp = server
        .client_black
        .post(format!("http://{}/api/games/{game_id}/abort", server.addr))
        .header("Authorization", "Bearer test-black-api-token-12345")
        .send()
        .await
        .unwrap();
    assert!(resp.status().is_success());
    let body: Value = resp.json().await.unwrap();
    assert_eq!(body["status"], "aborted");
}

#[tokio::test]
async fn request_undo_via_api() {
    let server = TestServer::start().await;
    let game_id = server
        .create_and_join_with(json!({"allow_undo": true}))
        .await;

    // Play a move first
    server
        .client_black
        .post(format!("http://{}/api/games/{game_id}/play", server.addr))
        .header("Authorization", "Bearer test-black-api-token-12345")
        .json(&json!({"col": 0, "row": 0}))
        .send()
        .await
        .unwrap();

    // Black requests undo (it's now white's turn, black can request undo of their last move)
    let resp = server
        .client_black
        .post(format!("http://{}/api/games/{game_id}/undo", server.addr))
        .header("Authorization", "Bearer test-black-api-token-12345")
        .send()
        .await
        .unwrap();
    assert!(
        resp.status().is_success(),
        "undo request failed: {}",
        resp.status()
    );
    let body: Value = resp.json().await.unwrap();
    assert_eq!(body["status"], "undo_requested");
}

#[tokio::test]
async fn respond_to_undo_via_api() {
    let server = TestServer::start().await;
    let game_id = server
        .create_and_join_with(json!({"allow_undo": true}))
        .await;

    // Play a move, then request undo
    server
        .client_black
        .post(format!("http://{}/api/games/{game_id}/play", server.addr))
        .header("Authorization", "Bearer test-black-api-token-12345")
        .json(&json!({"col": 0, "row": 0}))
        .send()
        .await
        .unwrap();

    server
        .client_black
        .post(format!("http://{}/api/games/{game_id}/undo", server.addr))
        .header("Authorization", "Bearer test-black-api-token-12345")
        .send()
        .await
        .unwrap();

    // White accepts
    let resp = server
        .client_white
        .post(format!(
            "http://{}/api/games/{game_id}/undo/respond",
            server.addr
        ))
        .header("Authorization", "Bearer test-white-api-token-67890")
        .json(&json!({"response": "accept"}))
        .send()
        .await
        .unwrap();
    assert!(
        resp.status().is_success(),
        "undo respond failed: {}",
        resp.status()
    );
}

#[tokio::test]
async fn respond_to_undo_reject() {
    let server = TestServer::start().await;
    let game_id = server
        .create_and_join_with(json!({"allow_undo": true}))
        .await;

    server
        .client_black
        .post(format!("http://{}/api/games/{game_id}/play", server.addr))
        .header("Authorization", "Bearer test-black-api-token-12345")
        .json(&json!({"col": 0, "row": 0}))
        .send()
        .await
        .unwrap();

    server
        .client_black
        .post(format!("http://{}/api/games/{game_id}/undo", server.addr))
        .header("Authorization", "Bearer test-black-api-token-12345")
        .send()
        .await
        .unwrap();

    // Invalid response value
    let resp = server
        .client_white
        .post(format!(
            "http://{}/api/games/{game_id}/undo/respond",
            server.addr
        ))
        .header("Authorization", "Bearer test-white-api-token-67890")
        .json(&json!({"response": "maybe"}))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 422);
}

#[tokio::test]
async fn send_and_get_chat_messages() {
    let server = TestServer::start().await;
    let game_id = server.create_game().await;

    // Send a message
    let resp = server
        .client_black
        .post(format!(
            "http://{}/api/games/{game_id}/messages",
            server.addr
        ))
        .header("Authorization", "Bearer test-black-api-token-12345")
        .json(&json!({"text": "Hello!"}))
        .send()
        .await
        .unwrap();
    assert!(resp.status().is_success());
    let msg: Value = resp.json().await.unwrap();
    assert_eq!(msg["text"], "Hello!");

    // Get messages
    let resp = server
        .client_black
        .get(format!(
            "http://{}/api/games/{game_id}/messages",
            server.addr
        ))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);
    let body: Vec<Value> = resp.json().await.unwrap();
    assert_eq!(body.len(), 1);
    assert_eq!(body[0]["text"], "Hello!");
}

#[tokio::test]
async fn get_turns_after_moves() {
    let server = TestServer::start().await;
    let game_id = server.create_and_join().await;

    // Play two moves
    server
        .client_black
        .post(format!("http://{}/api/games/{game_id}/play", server.addr))
        .header("Authorization", "Bearer test-black-api-token-12345")
        .json(&json!({"col": 2, "row": 2}))
        .send()
        .await
        .unwrap();

    server
        .client_white
        .post(format!("http://{}/api/games/{game_id}/play", server.addr))
        .header("Authorization", "Bearer test-white-api-token-67890")
        .json(&json!({"col": 6, "row": 6}))
        .send()
        .await
        .unwrap();

    let resp = server
        .client_black
        .get(format!("http://{}/api/games/{game_id}/turns", server.addr))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);
    let body: Vec<Value> = resp.json().await.unwrap();
    assert_eq!(body.len(), 2);
    assert_eq!(body[0]["kind"], "play");
    assert_eq!(body[0]["col"], 2);
    assert_eq!(body[0]["row"], 2);
    assert_eq!(body[1]["kind"], "play");
    assert_eq!(body[1]["col"], 6);
    assert_eq!(body[1]["row"], 6);
}

#[tokio::test]
async fn rematch_via_api() {
    let server = TestServer::start().await;
    let game_id = server.create_and_join().await;

    // Play a move and resign to finish the game
    server
        .client_black
        .post(format!("http://{}/api/games/{game_id}/play", server.addr))
        .header("Authorization", "Bearer test-black-api-token-12345")
        .json(&json!({"col": 0, "row": 0}))
        .send()
        .await
        .unwrap();

    server
        .client_black
        .post(format!("http://{}/api/games/{game_id}/resign", server.addr))
        .header("Authorization", "Bearer test-black-api-token-12345")
        .send()
        .await
        .unwrap();

    // Rematch
    let resp = server
        .client_black
        .post(format!(
            "http://{}/api/games/{game_id}/rematch",
            server.addr
        ))
        .header("Authorization", "Bearer test-black-api-token-12345")
        .json(&json!({}))
        .send()
        .await
        .unwrap();
    assert!(
        resp.status().is_success(),
        "rematch failed: {}",
        resp.status()
    );
    let body: Value = resp.json().await.unwrap();
    assert!(body["id"].is_i64());
    assert_ne!(body["id"], game_id, "rematch should create a new game");
}

#[tokio::test]
async fn rematch_unfinished_game_fails() {
    let server = TestServer::start().await;
    let game_id = server.create_and_join().await;

    let resp = server
        .client_black
        .post(format!(
            "http://{}/api/games/{game_id}/rematch",
            server.addr
        ))
        .header("Authorization", "Bearer test-black-api-token-12345")
        .json(&json!({}))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 422);
}

// ============================================================
// Auth / Error Handling
// ============================================================

#[tokio::test]
async fn missing_auth_returns_401() {
    let server = TestServer::start().await;

    // Endpoints that require auth
    let endpoints = vec![
        ("POST", format!("http://{}/api/games", server.addr)),
        ("GET", format!("http://{}/api/me", server.addr)),
    ];

    let client = reqwest::Client::new();
    for (method, url) in endpoints {
        let resp = match method {
            "POST" => client
                .post(&url)
                .json(&json!({"cols": 9, "rows": 9}))
                .send()
                .await
                .unwrap(),
            _ => client.get(&url).send().await.unwrap(),
        };
        assert_eq!(resp.status(), 401, "Expected 401 for {method} {url}");
        let body: Value = resp.json().await.unwrap();
        assert!(
            body["error"].is_string(),
            "Expected JSON error body for {method} {url}"
        );
    }
}

#[tokio::test]
async fn invalid_token_returns_401() {
    let server = TestServer::start().await;

    let resp = server
        .client_black
        .get(format!("http://{}/api/me", server.addr))
        .header("Authorization", "Bearer invalid-token-000")
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 401);
    let body: Value = resp.json().await.unwrap();
    assert!(body["error"].is_string());
}

#[tokio::test]
async fn wrong_turn_returns_error() {
    let server = TestServer::start().await;
    let game_id = server.create_and_join().await;

    // White tries to play first (it's black's turn)
    let resp = server
        .client_white
        .post(format!("http://{}/api/games/{game_id}/play", server.addr))
        .header("Authorization", "Bearer test-white-api-token-67890")
        .json(&json!({"col": 0, "row": 0}))
        .send()
        .await
        .unwrap();
    assert!(
        resp.status().is_client_error(),
        "Expected client error for wrong turn, got {}",
        resp.status()
    );
}

#[tokio::test]
async fn non_player_cannot_play() {
    let server = TestServer::start().await;
    let game_id = server.create_and_join().await;

    // Spectator tries to play
    let resp = server
        .client_spectator
        .post(format!("http://{}/api/games/{game_id}/play", server.addr))
        .header("Authorization", "Bearer test-spectator-api-token-99999")
        .json(&json!({"col": 0, "row": 0}))
        .send()
        .await
        .unwrap();
    assert!(resp.status().is_client_error());
}

#[tokio::test]
async fn play_on_nonexistent_game_returns_404() {
    let server = TestServer::start().await;

    let resp = server
        .client_black
        .post(format!("http://{}/api/games/99999/play", server.addr))
        .header("Authorization", "Bearer test-black-api-token-12345")
        .json(&json!({"col": 0, "row": 0}))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 404);
}

#[tokio::test]
async fn json_error_responses_have_error_field() {
    let server = TestServer::start().await;

    // 404
    let resp = server
        .client_black
        .get(format!("http://{}/api/games/99999", server.addr))
        .send()
        .await
        .unwrap();
    let body: Value = resp.json().await.unwrap();
    assert!(
        body["error"].is_string(),
        "404 response should have 'error' field: {body}"
    );

    // 401
    let resp = reqwest::Client::new()
        .get(format!("http://{}/api/me", server.addr))
        .send()
        .await
        .unwrap();
    let body: Value = resp.json().await.unwrap();
    assert!(
        body["error"].is_string(),
        "401 response should have 'error' field: {body}"
    );

    // 422
    let resp = server.try_create_game_with(json!({"komi": 0})).await;
    let body: Value = resp.json().await.unwrap();
    assert!(
        body["error"].is_string(),
        "422 response should have 'error' field: {body}"
    );
}

// ============================================================
// Board dimension clamping — 2-41 inclusive
// ============================================================

#[tokio::test]
async fn reject_board_dimensions_outside_range() {
    let server = TestServer::start().await;

    // Below minimum
    let resp = server
        .try_create_game_with(json!({"cols": 1, "rows": 9}))
        .await;
    assert_eq!(resp.status(), 422);

    let resp = server
        .try_create_game_with(json!({"cols": 9, "rows": 0}))
        .await;
    assert_eq!(resp.status(), 422);

    // Above maximum
    let resp = server
        .try_create_game_with(json!({"cols": 42, "rows": 9}))
        .await;
    assert_eq!(resp.status(), 422);

    let resp = server
        .try_create_game_with(json!({"cols": 9, "rows": 42}))
        .await;
    assert_eq!(resp.status(), 422);

    // Negative
    let resp = server
        .try_create_game_with(json!({"cols": -1, "rows": 9}))
        .await;
    assert_eq!(resp.status(), 422);
}

#[tokio::test]
async fn accept_board_dimensions_within_range() {
    let server = TestServer::start().await;

    // Boundaries
    let resp = server
        .try_create_game_with(json!({"cols": 2, "rows": 2}))
        .await;
    assert!(resp.status().is_success(), "2x2 should be accepted");

    let resp = server
        .try_create_game_with(json!({"cols": 41, "rows": 41}))
        .await;
    assert!(resp.status().is_success(), "41x41 should be accepted");

    // Unconventional size within range
    let resp = server
        .try_create_game_with(json!({"cols": 7, "rows": 11}))
        .await;
    assert!(resp.status().is_success(), "7x11 should be accepted");
}

// ============================================================
// Challenge Accept / Decline
// ============================================================

#[tokio::test]
async fn accept_challenge_via_api() {
    let server = TestServer::start().await;
    let game_id = server.create_challenge().await;

    // White (the challenged player) accepts
    let resp = server
        .client_white
        .post(format!("http://{}/api/games/{game_id}/accept", server.addr))
        .header("Authorization", "Bearer test-white-api-token-67890")
        .send()
        .await
        .unwrap();
    assert!(
        resp.status().is_success(),
        "accept_challenge failed: {}",
        resp.status()
    );
    let body: Value = resp.json().await.unwrap();
    assert_eq!(body["status"], "accepted");

    // Verify the game is now in a playing stage
    let resp = server
        .client_black
        .get(format!("http://{}/api/games/{game_id}", server.addr))
        .send()
        .await
        .unwrap();
    let game: Value = resp.json().await.unwrap();
    let stage = game["stage"].as_str().unwrap();
    assert!(
        stage == "black_to_play" || stage == "white_to_play",
        "Expected playing stage after accept, got: {stage}"
    );
}

#[tokio::test]
async fn accept_challenge_game_is_playable() {
    let server = TestServer::start().await;
    let game_id = server.create_challenge().await;

    // Accept the challenge
    server
        .client_white
        .post(format!("http://{}/api/games/{game_id}/accept", server.addr))
        .header("Authorization", "Bearer test-white-api-token-67890")
        .send()
        .await
        .unwrap();

    // Black should be able to play a move
    let resp = server
        .client_black
        .post(format!("http://{}/api/games/{game_id}/play", server.addr))
        .header("Authorization", "Bearer test-black-api-token-12345")
        .json(&json!({"col": 4, "row": 4}))
        .send()
        .await
        .unwrap();
    assert!(
        resp.status().is_success(),
        "Should be able to play after accepting challenge: {}",
        resp.status()
    );
}

#[tokio::test]
async fn creator_cannot_accept_own_challenge() {
    let server = TestServer::start().await;
    let game_id = server.create_challenge().await;

    // Black (creator) tries to accept
    let resp = server
        .client_black
        .post(format!("http://{}/api/games/{game_id}/accept", server.addr))
        .header("Authorization", "Bearer test-black-api-token-12345")
        .send()
        .await
        .unwrap();
    assert!(
        resp.status().is_client_error(),
        "Creator should not be able to accept own challenge"
    );
}

#[tokio::test]
async fn non_participant_cannot_accept_challenge() {
    let server = TestServer::start().await;
    let game_id = server.create_challenge().await;

    // Spectator tries to accept
    let resp = server
        .client_spectator
        .post(format!("http://{}/api/games/{game_id}/accept", server.addr))
        .header("Authorization", "Bearer test-spectator-api-token-99999")
        .send()
        .await
        .unwrap();
    assert!(
        resp.status().is_client_error(),
        "Non-participant should not be able to accept challenge"
    );
}

#[tokio::test]
async fn cannot_accept_non_challenge_game() {
    let server = TestServer::start().await;
    // create_and_join creates a game where white joins (not a challenge)
    let game_id = server.create_and_join().await;

    let resp = server
        .client_white
        .post(format!("http://{}/api/games/{game_id}/accept", server.addr))
        .header("Authorization", "Bearer test-white-api-token-67890")
        .send()
        .await
        .unwrap();
    assert!(
        resp.status().is_client_error(),
        "Should not accept a game that is not in challenge state"
    );
}

#[tokio::test]
async fn cannot_accept_already_accepted_challenge() {
    let server = TestServer::start().await;
    let game_id = server.create_challenge().await;

    // Accept once
    server
        .client_white
        .post(format!("http://{}/api/games/{game_id}/accept", server.addr))
        .header("Authorization", "Bearer test-white-api-token-67890")
        .send()
        .await
        .unwrap();

    // Try to accept again
    let resp = server
        .client_white
        .post(format!("http://{}/api/games/{game_id}/accept", server.addr))
        .header("Authorization", "Bearer test-white-api-token-67890")
        .send()
        .await
        .unwrap();
    assert!(
        resp.status().is_client_error(),
        "Should not accept an already accepted challenge"
    );
}

#[tokio::test]
async fn decline_challenge_via_api() {
    let server = TestServer::start().await;
    let game_id = server.create_challenge().await;

    // White (the challenged player) declines
    let resp = server
        .client_white
        .post(format!(
            "http://{}/api/games/{game_id}/decline",
            server.addr
        ))
        .header("Authorization", "Bearer test-white-api-token-67890")
        .send()
        .await
        .unwrap();
    assert!(
        resp.status().is_success(),
        "decline_challenge failed: {}",
        resp.status()
    );
    let body: Value = resp.json().await.unwrap();
    assert_eq!(body["status"], "declined");

    // Verify the game is now in declined state
    let resp = server
        .client_black
        .get(format!("http://{}/api/games/{game_id}", server.addr))
        .send()
        .await
        .unwrap();
    let game: Value = resp.json().await.unwrap();
    assert_eq!(game["stage"], "declined");
    assert_eq!(game["result"], "Declined");
}

#[tokio::test]
async fn creator_cannot_decline_own_challenge() {
    let server = TestServer::start().await;
    let game_id = server.create_challenge().await;

    // Black (creator) tries to decline
    let resp = server
        .client_black
        .post(format!(
            "http://{}/api/games/{game_id}/decline",
            server.addr
        ))
        .header("Authorization", "Bearer test-black-api-token-12345")
        .send()
        .await
        .unwrap();
    assert!(
        resp.status().is_client_error(),
        "Creator should not be able to decline own challenge"
    );
}

#[tokio::test]
async fn non_participant_cannot_decline_challenge() {
    let server = TestServer::start().await;
    let game_id = server.create_challenge().await;

    // Spectator tries to decline
    let resp = server
        .client_spectator
        .post(format!(
            "http://{}/api/games/{game_id}/decline",
            server.addr
        ))
        .header("Authorization", "Bearer test-spectator-api-token-99999")
        .send()
        .await
        .unwrap();
    assert!(
        resp.status().is_client_error(),
        "Non-participant should not be able to decline challenge"
    );
}

#[tokio::test]
async fn cannot_decline_non_challenge_game() {
    let server = TestServer::start().await;
    let game_id = server.create_and_join().await;

    let resp = server
        .client_white
        .post(format!(
            "http://{}/api/games/{game_id}/decline",
            server.addr
        ))
        .header("Authorization", "Bearer test-white-api-token-67890")
        .send()
        .await
        .unwrap();
    assert!(
        resp.status().is_client_error(),
        "Should not decline a game that is not in challenge state"
    );
}

#[tokio::test]
async fn cannot_decline_already_declined_challenge() {
    let server = TestServer::start().await;
    let game_id = server.create_challenge().await;

    // Decline once
    server
        .client_white
        .post(format!(
            "http://{}/api/games/{game_id}/decline",
            server.addr
        ))
        .header("Authorization", "Bearer test-white-api-token-67890")
        .send()
        .await
        .unwrap();

    // Try to decline again
    let resp = server
        .client_white
        .post(format!(
            "http://{}/api/games/{game_id}/decline",
            server.addr
        ))
        .header("Authorization", "Bearer test-white-api-token-67890")
        .send()
        .await
        .unwrap();
    assert!(
        resp.status().is_client_error(),
        "Should not decline an already declined challenge"
    );
}

#[tokio::test]
async fn cannot_accept_declined_challenge() {
    let server = TestServer::start().await;
    let game_id = server.create_challenge().await;

    // Decline first
    server
        .client_white
        .post(format!(
            "http://{}/api/games/{game_id}/decline",
            server.addr
        ))
        .header("Authorization", "Bearer test-white-api-token-67890")
        .send()
        .await
        .unwrap();

    // Try to accept
    let resp = server
        .client_white
        .post(format!("http://{}/api/games/{game_id}/accept", server.addr))
        .header("Authorization", "Bearer test-white-api-token-67890")
        .send()
        .await
        .unwrap();
    assert!(
        resp.status().is_client_error(),
        "Should not accept an already declined challenge"
    );
}

#[tokio::test]
async fn accept_challenge_on_nonexistent_game_returns_404() {
    let server = TestServer::start().await;

    let resp = server
        .client_white
        .post(format!("http://{}/api/games/99999/accept", server.addr))
        .header("Authorization", "Bearer test-white-api-token-67890")
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 404);
}

#[tokio::test]
async fn decline_challenge_on_nonexistent_game_returns_404() {
    let server = TestServer::start().await;

    let resp = server
        .client_white
        .post(format!("http://{}/api/games/99999/decline", server.addr))
        .header("Authorization", "Bearer test-white-api-token-67890")
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 404);
}

#[tokio::test]
async fn accept_challenge_requires_auth() {
    let server = TestServer::start().await;
    let game_id = server.create_challenge().await;

    let resp = reqwest::Client::new()
        .post(format!("http://{}/api/games/{game_id}/accept", server.addr))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 401);
}

#[tokio::test]
async fn decline_challenge_requires_auth() {
    let server = TestServer::start().await;
    let game_id = server.create_challenge().await;

    let resp = reqwest::Client::new()
        .post(format!(
            "http://{}/api/games/{game_id}/decline",
            server.addr
        ))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 401);
}

// ============================================================
// Territory Review
// ============================================================

#[tokio::test]
async fn toggle_chain_via_api() {
    let server = TestServer::start().await;
    let game_id = server.enter_territory_review().await;

    // Toggle a chain (the board is empty, but the endpoint should still succeed)
    let resp = server
        .client_black
        .post(format!(
            "http://{}/api/games/{game_id}/territory/toggle",
            server.addr
        ))
        .header("Authorization", "Bearer test-black-api-token-12345")
        .json(&json!({"col": 0, "row": 0}))
        .send()
        .await
        .unwrap();
    assert!(
        resp.status().is_success(),
        "toggle_chain failed: {}",
        resp.status()
    );
    let body: Value = resp.json().await.unwrap();
    assert_eq!(body["stage"], "territory_review");
    assert!(
        body["territory"].is_object(),
        "expected territory in response"
    );
    // After toggle, both approvals should be reset
    assert_eq!(body["territory"]["black_approved"], false);
    assert_eq!(body["territory"]["white_approved"], false);
}

#[tokio::test]
async fn approve_territory_via_api() {
    let server = TestServer::start().await;
    let game_id = server.enter_territory_review().await;

    // Black approves
    let resp = server
        .client_black
        .post(format!(
            "http://{}/api/games/{game_id}/territory/approve",
            server.addr
        ))
        .header("Authorization", "Bearer test-black-api-token-12345")
        .send()
        .await
        .unwrap();
    assert!(
        resp.status().is_success(),
        "black approve failed: {}",
        resp.status()
    );
    let body: Value = resp.json().await.unwrap();
    assert_eq!(body["territory"]["black_approved"], true);
    assert_eq!(body["territory"]["white_approved"], false);
    assert_eq!(body["stage"], "territory_review");

    // White approves — game should settle
    let resp = server
        .client_white
        .post(format!(
            "http://{}/api/games/{game_id}/territory/approve",
            server.addr
        ))
        .header("Authorization", "Bearer test-white-api-token-67890")
        .send()
        .await
        .unwrap();
    assert!(
        resp.status().is_success(),
        "white approve failed: {}",
        resp.status()
    );
    let body: Value = resp.json().await.unwrap();
    assert_eq!(body["stage"], "completed");
    assert!(
        body["result"].is_string(),
        "expected result after settlement"
    );
}

#[tokio::test]
async fn toggle_resets_approval() {
    let server = TestServer::start().await;
    let game_id = server.enter_territory_review().await;

    // Black approves
    server
        .client_black
        .post(format!(
            "http://{}/api/games/{game_id}/territory/approve",
            server.addr
        ))
        .header("Authorization", "Bearer test-black-api-token-12345")
        .send()
        .await
        .unwrap();

    // White toggles a chain — should reset both approvals
    let resp = server
        .client_white
        .post(format!(
            "http://{}/api/games/{game_id}/territory/toggle",
            server.addr
        ))
        .header("Authorization", "Bearer test-white-api-token-67890")
        .json(&json!({"col": 0, "row": 0}))
        .send()
        .await
        .unwrap();
    assert!(resp.status().is_success());
    let body: Value = resp.json().await.unwrap();
    assert_eq!(body["territory"]["black_approved"], false);
    assert_eq!(body["territory"]["white_approved"], false);
    assert_eq!(body["stage"], "territory_review");
}

#[tokio::test]
async fn toggle_chain_outside_territory_review() {
    let server = TestServer::start().await;
    let game_id = server.create_and_join().await;

    // Game is in play stage, not territory review
    let resp = server
        .client_black
        .post(format!(
            "http://{}/api/games/{game_id}/territory/toggle",
            server.addr
        ))
        .header("Authorization", "Bearer test-black-api-token-12345")
        .json(&json!({"col": 0, "row": 0}))
        .send()
        .await
        .unwrap();
    assert!(
        resp.status().is_client_error(),
        "toggle should fail outside territory review"
    );
    let body: Value = resp.json().await.unwrap();
    assert!(
        body["error"].as_str().unwrap().contains("territory review"),
        "expected territory review error, got: {}",
        body["error"]
    );
}

#[tokio::test]
async fn approve_territory_outside_territory_review() {
    let server = TestServer::start().await;
    let game_id = server.create_and_join().await;

    let resp = server
        .client_black
        .post(format!(
            "http://{}/api/games/{game_id}/territory/approve",
            server.addr
        ))
        .header("Authorization", "Bearer test-black-api-token-12345")
        .send()
        .await
        .unwrap();
    assert!(
        resp.status().is_client_error(),
        "approve should fail outside territory review"
    );
}

#[tokio::test]
async fn approve_territory_twice_returns_error() {
    let server = TestServer::start().await;
    let game_id = server.enter_territory_review().await;

    // Black approves once
    server
        .client_black
        .post(format!(
            "http://{}/api/games/{game_id}/territory/approve",
            server.addr
        ))
        .header("Authorization", "Bearer test-black-api-token-12345")
        .send()
        .await
        .unwrap();

    // Black tries to approve again
    let resp = server
        .client_black
        .post(format!(
            "http://{}/api/games/{game_id}/territory/approve",
            server.addr
        ))
        .header("Authorization", "Bearer test-black-api-token-12345")
        .send()
        .await
        .unwrap();
    assert!(
        resp.status().is_client_error(),
        "double approve should fail"
    );
    let body: Value = resp.json().await.unwrap();
    assert!(
        body["error"].as_str().unwrap().contains("already approved"),
        "expected already approved error, got: {}",
        body["error"]
    );
}

#[tokio::test]
async fn non_player_cannot_toggle_chain() {
    let server = TestServer::start().await;
    let game_id = server.enter_territory_review().await;

    let resp = server
        .client_spectator
        .post(format!(
            "http://{}/api/games/{game_id}/territory/toggle",
            server.addr
        ))
        .header("Authorization", "Bearer test-spectator-api-token-99999")
        .json(&json!({"col": 0, "row": 0}))
        .send()
        .await
        .unwrap();
    assert!(
        resp.status().is_client_error(),
        "non-player should not be able to toggle chain"
    );
}

#[tokio::test]
async fn non_player_cannot_approve_territory() {
    let server = TestServer::start().await;
    let game_id = server.enter_territory_review().await;

    let resp = server
        .client_spectator
        .post(format!(
            "http://{}/api/games/{game_id}/territory/approve",
            server.addr
        ))
        .header("Authorization", "Bearer test-spectator-api-token-99999")
        .send()
        .await
        .unwrap();
    assert!(
        resp.status().is_client_error(),
        "non-player should not be able to approve territory"
    );
}

#[tokio::test]
async fn toggle_chain_requires_auth() {
    let server = TestServer::start().await;
    let game_id = server.enter_territory_review().await;

    let resp = reqwest::Client::new()
        .post(format!(
            "http://{}/api/games/{game_id}/territory/toggle",
            server.addr
        ))
        .json(&json!({"col": 0, "row": 0}))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 401);
}

#[tokio::test]
async fn approve_territory_requires_auth() {
    let server = TestServer::start().await;
    let game_id = server.enter_territory_review().await;

    let resp = reqwest::Client::new()
        .post(format!(
            "http://{}/api/games/{game_id}/territory/approve",
            server.addr
        ))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 401);
}
