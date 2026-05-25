use axum::http::Method;
use serde_json::{Value, json};

use crate::common::{LightServer, TestServer};

fn assert_api_error(body: &Value, code: &str) -> String {
    assert_eq!(
        body["error"]["code"], code,
        "unexpected API error body: {body}"
    );
    body["error"]["message"]
        .as_str()
        .unwrap_or_else(|| panic!("missing API error message in body: {body}"))
        .to_string()
}

// ============================================================
// Public Endpoints
// ============================================================

#[tokio::test]
async fn list_games_returns_public_games() {
    let server = LightServer::start().await;

    // No games yet
    let resp = server
        .request_no_auth(Method::GET, "/api/games", None)
        .await;
    assert_eq!(resp.status(), 200);
    let body: Vec<Value> = resp.json().await.unwrap();
    assert!(body.is_empty());

    // Create a game
    server.create_game().await;

    let resp = server
        .request_no_auth(Method::GET, "/api/games", None)
        .await;
    assert_eq!(resp.status(), 200);
    let body: Vec<Value> = resp.json().await.unwrap();
    assert!(!body.is_empty());
}

#[tokio::test]
async fn list_games_no_auth_required() {
    let server = LightServer::start().await;

    let resp = server
        .request_no_auth(Method::GET, "/api/games", None)
        .await;
    assert_eq!(resp.status(), 200);
}

#[tokio::test]
async fn get_game_returns_game_state() {
    let server = LightServer::start().await;
    let game_id = server.create_game().await;

    let resp = server
        .request(
            Method::GET,
            &format!("/api/games/{game_id}"),
            "test-black-api-token-12345",
            None,
        )
        .await;
    assert_eq!(resp.status(), 200);
    let body: Value = resp.json().await.unwrap();
    assert_eq!(body["id"], game_id);
    assert_eq!(body["cols"], 9);
    assert_eq!(body["rows"], 9);
    assert!(body["state"].is_object());
}

#[tokio::test]
async fn get_game_no_auth_for_public_game() {
    let server = LightServer::start().await;
    let game_id = server.create_game().await;

    let resp = server
        .request_no_auth(Method::GET, &format!("/api/games/{game_id}"), None)
        .await;
    assert_eq!(resp.status(), 200);
}

#[tokio::test]
async fn get_game_404_for_nonexistent() {
    let server = LightServer::start().await;

    let resp = server
        .request(
            Method::GET,
            "/api/games/99999",
            "test-black-api-token-12345",
            None,
        )
        .await;
    assert_eq!(resp.status(), 404);
    let body: Value = resp.json().await.unwrap();
    assert_eq!(assert_api_error(&body, "not_found"), "Record not found");
}

#[tokio::test]
async fn get_messages_returns_empty_initially() {
    let server = LightServer::start().await;
    let game_id = server.create_game().await;

    let resp = server
        .request(
            Method::GET,
            &format!("/api/games/{game_id}/messages"),
            "test-black-api-token-12345",
            None,
        )
        .await;
    assert_eq!(resp.status(), 200);
    let body: Vec<Value> = resp.json().await.unwrap();
    assert!(body.is_empty());
}

#[tokio::test]
async fn get_messages_404_for_nonexistent_game() {
    let server = LightServer::start().await;

    let resp = server
        .request(
            Method::GET,
            "/api/games/99999/messages",
            "test-black-api-token-12345",
            None,
        )
        .await;
    assert_eq!(resp.status(), 404);
}

#[tokio::test]
async fn get_turns_returns_empty_initially() {
    let server = LightServer::start().await;
    let game_id = server.create_game().await;

    let resp = server
        .request(
            Method::GET,
            &format!("/api/games/{game_id}/turns"),
            "test-black-api-token-12345",
            None,
        )
        .await;
    assert_eq!(resp.status(), 200);
    let body: Vec<Value> = resp.json().await.unwrap();
    assert!(body.is_empty());
}

#[tokio::test]
async fn get_turns_404_for_nonexistent_game() {
    let server = LightServer::start().await;

    let resp = server
        .request(
            Method::GET,
            "/api/games/99999/turns",
            "test-black-api-token-12345",
            None,
        )
        .await;
    assert_eq!(resp.status(), 404);
}

#[tokio::test]
async fn get_user_returns_profile() {
    let server = LightServer::start().await;

    let resp = server
        .request_no_auth(Method::GET, "/api/users/test-black", None)
        .await;
    assert_eq!(resp.status(), 200);
    let body: Value = resp.json().await.unwrap();
    assert_eq!(body["username"], "test-black");
    assert_eq!(body["is_registered"], true);
}

#[tokio::test]
async fn get_user_404_for_nonexistent() {
    let server = LightServer::start().await;

    let resp = server
        .request_no_auth(Method::GET, "/api/users/nonexistent-user", None)
        .await;
    assert_eq!(resp.status(), 404);
    let body: Value = resp.json().await.unwrap();
    assert_eq!(assert_api_error(&body, "not_found"), "User not found");
}

#[tokio::test]
async fn get_user_games_returns_list() {
    let server = LightServer::start().await;

    // No games yet
    let resp = server
        .request_no_auth(Method::GET, "/api/users/test-black/games", None)
        .await;
    assert_eq!(resp.status(), 200);
    let body: Vec<Value> = resp.json().await.unwrap();
    assert!(body.is_empty());

    // Create a game
    server.create_game().await;

    let resp = server
        .request_no_auth(Method::GET, "/api/users/test-black/games", None)
        .await;
    assert_eq!(resp.status(), 200);
    let body: Vec<Value> = resp.json().await.unwrap();
    assert_eq!(body.len(), 1);
}

#[tokio::test]
async fn get_user_games_404_for_nonexistent_user() {
    let server = LightServer::start().await;

    let resp = server
        .request_no_auth(Method::GET, "/api/users/nonexistent-user/games", None)
        .await;
    assert_eq!(resp.status(), 404);
}

// ============================================================
// Authenticated Endpoints
// ============================================================

#[tokio::test]
async fn get_me_returns_current_user() {
    let server = LightServer::start().await;

    let resp = server
        .request(Method::GET, "/api/me", "test-black-api-token-12345", None)
        .await;
    assert_eq!(resp.status(), 200);
    let body: Value = resp.json().await.unwrap();
    assert_eq!(body["username"], "test-black");
    assert_eq!(body["is_registered"], true);
}

#[tokio::test]
async fn create_game_via_api() {
    let server = LightServer::start().await;

    let resp = server
        .request(
            Method::POST,
            "/api/games",
            "test-black-api-token-12345",
            Some(&json!({"cols": 9})),
        )
        .await;
    assert_eq!(resp.status(), 201, "create_game should return 201 Created");
    let body: Value = resp.json().await.unwrap();
    assert!(body["id"].is_i64());
    assert_eq!(body["cols"], 9);
    assert_eq!(body["rows"], 9);
    assert!(body["creator"].is_object());
    assert_eq!(body["creator"]["username"], "test-black");
    assert!(body["opponent"].is_null());
    assert!(body["black"].is_null());
    assert!(body["white"].is_null());
}

#[tokio::test]
async fn create_random_challenge_leaves_colors_unset_until_accept() {
    let server = LightServer::start().await;

    let resp = server
        .request(
            Method::POST,
            "/api/games",
            "test-black-api-token-12345",
            Some(&json!({
                "cols": 9,
                "invite_username": "test-white",
                "komi": 6.5,
                "handicap": 0,
                "color": "random",
            })),
        )
        .await;
    assert_eq!(resp.status(), 201);
    let body: Value = resp.json().await.unwrap();
    let game_id = body["id"].as_i64().expect("game id missing from response");
    assert!(body["creator"].is_object());
    assert!(body["opponent"].is_object());
    assert!(body["black"].is_null());
    assert!(body["white"].is_null());

    let (black_id, white_id, stage): (Option<i64>, Option<i64>, String) =
        sqlx::query_as("SELECT black_id, white_id, stage FROM games WHERE id = $1")
            .bind(game_id)
            .fetch_one(&server.pool)
            .await
            .unwrap();
    assert!(black_id.is_none());
    assert!(white_id.is_none());
    assert_eq!(stage, "challenge");

    let resp = server
        .request(
            Method::POST,
            &format!("/api/games/{game_id}/accept"),
            "test-white-api-token-67890",
            None,
        )
        .await;
    assert_eq!(resp.status(), 200);

    let (black_id, white_id, stage): (Option<i64>, Option<i64>, String) =
        sqlx::query_as("SELECT black_id, white_id, stage FROM games WHERE id = $1")
            .bind(game_id)
            .fetch_one(&server.pool)
            .await
            .unwrap();
    assert!(black_id.is_some());
    assert!(white_id.is_some());
    assert_ne!(black_id, white_id);
    assert!(stage == "black_to_play" || stage == "white_to_play");
}

#[tokio::test]
async fn delete_unstarted_game() {
    let server = LightServer::start().await;
    let game_id = server.create_game().await;

    let resp = server
        .request(
            Method::DELETE,
            &format!("/api/games/{game_id}"),
            "test-black-api-token-12345",
            None,
        )
        .await;
    assert!(resp.status().is_success());
    let body: Value = resp.json().await.unwrap();
    assert_eq!(body["deleted"], true);

    // Verify game is gone
    let resp = server
        .request(
            Method::GET,
            &format!("/api/games/{game_id}"),
            "test-black-api-token-12345",
            None,
        )
        .await;
    assert_eq!(resp.status(), 404);
}

#[tokio::test]
async fn delete_game_only_by_creator() {
    let server = LightServer::start().await;
    let game_id = server.create_game().await;

    let resp = server
        .request(
            Method::DELETE,
            &format!("/api/games/{game_id}"),
            "test-white-api-token-67890",
            None,
        )
        .await;
    assert_eq!(resp.status(), 422);
}

#[tokio::test]
async fn delete_started_game_fails() {
    let server = LightServer::start().await;
    let game_id = server.create_and_join().await;

    // Play a move so the game is started (started_at is set on first move)
    server
        .request(
            Method::POST,
            &format!("/api/games/{game_id}/play"),
            "test-black-api-token-12345",
            Some(&json!({"col": 0, "row": 0})),
        )
        .await;

    let resp = server
        .request(
            Method::DELETE,
            &format!("/api/games/{game_id}"),
            "test-black-api-token-12345",
            None,
        )
        .await;
    assert_eq!(resp.status(), 422);
    let body: Value = resp.json().await.unwrap();
    assert!(assert_api_error(&body, "validation_error").contains("started"));
}

#[tokio::test]
async fn join_game_via_api() {
    let server = LightServer::start().await;
    let game_id = server.create_game().await;

    let resp = server
        .request(
            Method::POST,
            &format!("/api/games/{game_id}/join"),
            "test-white-api-token-67890",
            Some(&json!({})),
        )
        .await;
    assert!(resp.status().is_success());
    let body: Value = resp.json().await.unwrap();
    assert!(body["opponent"].is_object());
    assert_eq!(body["opponent"]["username"], "test-white");
    assert!(body["black"].is_null());
    assert!(body["white"].is_null());
}

#[tokio::test]
async fn play_move_via_api() {
    let server = LightServer::start().await;
    let game_id = server.create_and_join().await;

    let resp = server
        .request(
            Method::POST,
            &format!("/api/games/{game_id}/play"),
            "test-black-api-token-12345",
            Some(&json!({"col": 2, "row": 2})),
        )
        .await;
    assert!(resp.status().is_success());
    let body: Value = resp.json().await.unwrap();
    assert!(body["state"].is_object());
}

#[tokio::test]
async fn pass_via_api() {
    let server = LightServer::start().await;
    let game_id = server.create_and_join().await;

    let resp = server
        .request(
            Method::POST,
            &format!("/api/games/{game_id}/pass"),
            "test-black-api-token-12345",
            None,
        )
        .await;
    assert!(resp.status().is_success());
}

#[tokio::test]
async fn resign_via_api() {
    let server = LightServer::start().await;
    let game_id = server.create_and_join().await;

    // Play a move first (can't resign before first move)
    server
        .request(
            Method::POST,
            &format!("/api/games/{game_id}/play"),
            "test-black-api-token-12345",
            Some(&json!({"col": 0, "row": 0})),
        )
        .await;

    let resp = server
        .request(
            Method::POST,
            &format!("/api/games/{game_id}/resign"),
            "test-black-api-token-12345",
            None,
        )
        .await;
    assert!(resp.status().is_success());
    let body: Value = resp.json().await.unwrap();
    assert!(body["result"].is_string());
}

#[tokio::test]
async fn abort_via_api() {
    let server = LightServer::start().await;
    let game_id = server.create_game().await;

    let resp = server
        .request(
            Method::POST,
            &format!("/api/games/{game_id}/abort"),
            "test-black-api-token-12345",
            None,
        )
        .await;
    assert!(resp.status().is_success());
    let body: Value = resp.json().await.unwrap();
    assert_eq!(body["status"], "aborted");
}

#[tokio::test]
async fn request_undo_via_api() {
    let server = LightServer::start().await;
    let game_id = server
        .create_and_join_with(json!({"allow_undo": true}))
        .await;

    // Play a move first
    server
        .request(
            Method::POST,
            &format!("/api/games/{game_id}/play"),
            "test-black-api-token-12345",
            Some(&json!({"col": 0, "row": 0})),
        )
        .await;

    let resp = server
        .request(
            Method::POST,
            &format!("/api/games/{game_id}/undo"),
            "test-black-api-token-12345",
            None,
        )
        .await;
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
    let server = LightServer::start().await;
    let game_id = server
        .create_and_join_with(json!({"allow_undo": true}))
        .await;

    // Play a move, then request undo
    server
        .request(
            Method::POST,
            &format!("/api/games/{game_id}/play"),
            "test-black-api-token-12345",
            Some(&json!({"col": 0, "row": 0})),
        )
        .await;

    server
        .request(
            Method::POST,
            &format!("/api/games/{game_id}/undo"),
            "test-black-api-token-12345",
            None,
        )
        .await;

    let resp = server
        .request(
            Method::POST,
            &format!("/api/games/{game_id}/undo/respond"),
            "test-white-api-token-67890",
            Some(&json!({"response": "accept"})),
        )
        .await;
    assert!(
        resp.status().is_success(),
        "undo respond failed: {}",
        resp.status()
    );
}

#[tokio::test]
async fn respond_to_undo_reject() {
    let server = LightServer::start().await;
    let game_id = server
        .create_and_join_with(json!({"allow_undo": true}))
        .await;

    server
        .request(
            Method::POST,
            &format!("/api/games/{game_id}/play"),
            "test-black-api-token-12345",
            Some(&json!({"col": 0, "row": 0})),
        )
        .await;

    server
        .request(
            Method::POST,
            &format!("/api/games/{game_id}/undo"),
            "test-black-api-token-12345",
            None,
        )
        .await;

    let resp = server
        .request(
            Method::POST,
            &format!("/api/games/{game_id}/undo/respond"),
            "test-white-api-token-67890",
            Some(&json!({"response": "maybe"})),
        )
        .await;
    assert_eq!(resp.status(), 422);
}

#[tokio::test]
async fn send_and_get_chat_messages() {
    let server = LightServer::start().await;
    let game_id = server.create_game().await;

    let resp = server
        .request(
            Method::POST,
            &format!("/api/games/{game_id}/messages"),
            "test-black-api-token-12345",
            Some(&json!({"text": "Hello!"})),
        )
        .await;
    assert!(resp.status().is_success());
    let msg: Value = resp.json().await.unwrap();
    assert_eq!(msg["text"], "Hello!");

    let resp = server
        .request(
            Method::GET,
            &format!("/api/games/{game_id}/messages"),
            "test-black-api-token-12345",
            None,
        )
        .await;
    assert_eq!(resp.status(), 200);
    let body: Vec<Value> = resp.json().await.unwrap();
    assert_eq!(body.len(), 1);
    assert_eq!(body[0]["text"], "Hello!");
}

#[tokio::test]
async fn get_turns_after_moves() {
    let server = LightServer::start().await;
    let game_id = server.create_and_join().await;

    server
        .request(
            Method::POST,
            &format!("/api/games/{game_id}/play"),
            "test-black-api-token-12345",
            Some(&json!({"col": 2, "row": 2})),
        )
        .await;

    server
        .request(
            Method::POST,
            &format!("/api/games/{game_id}/play"),
            "test-white-api-token-67890",
            Some(&json!({"col": 6, "row": 6})),
        )
        .await;

    let resp = server
        .request(
            Method::GET,
            &format!("/api/games/{game_id}/turns"),
            "test-black-api-token-12345",
            None,
        )
        .await;
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
    let server = LightServer::start().await;
    let game_id = server.create_and_join().await;

    server
        .request(
            Method::POST,
            &format!("/api/games/{game_id}/play"),
            "test-black-api-token-12345",
            Some(&json!({"col": 0, "row": 0})),
        )
        .await;

    server
        .request(
            Method::POST,
            &format!("/api/games/{game_id}/resign"),
            "test-black-api-token-12345",
            None,
        )
        .await;

    let resp = server
        .request(
            Method::POST,
            &format!("/api/games/{game_id}/rematch"),
            "test-black-api-token-12345",
            Some(&json!({})),
        )
        .await;
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
    let server = LightServer::start().await;
    let game_id = server.create_and_join().await;

    let resp = server
        .request(
            Method::POST,
            &format!("/api/games/{game_id}/rematch"),
            "test-black-api-token-12345",
            Some(&json!({})),
        )
        .await;
    assert_eq!(resp.status(), 422);
}

// ============================================================
// Auth / Error Handling
// ============================================================

#[tokio::test]
async fn missing_auth_returns_401() {
    let server = LightServer::start().await;

    let resp = server
        .request_no_auth(
            Method::POST,
            "/api/games",
            Some(&json!({"cols": 9, "rows": 9})),
        )
        .await;
    assert_eq!(resp.status(), 401);
    let body: Value = resp.json().await.unwrap();
    assert!(body["error"]["message"].is_string());
    assert_eq!(body["error"]["code"], "unauthorized");

    let resp = server.request_no_auth(Method::GET, "/api/me", None).await;
    assert_eq!(resp.status(), 401);
    let body: Value = resp.json().await.unwrap();
    assert!(body["error"]["message"].is_string());
    assert_eq!(body["error"]["code"], "unauthorized");
}

#[tokio::test]
async fn invalid_token_returns_401() {
    let server = LightServer::start().await;

    let resp = server
        .request(Method::GET, "/api/me", "invalid-token-000", None)
        .await;
    assert_eq!(resp.status(), 401);
    let body: Value = resp.json().await.unwrap();
    assert_eq!(assert_api_error(&body, "unauthorized"), "Invalid API token");
}

#[tokio::test]
async fn wrong_turn_returns_error() {
    let server = LightServer::start().await;
    let game_id = server.create_and_join().await;

    let resp = server
        .request(
            Method::POST,
            &format!("/api/games/{game_id}/play"),
            "test-white-api-token-67890",
            Some(&json!({"col": 0, "row": 0})),
        )
        .await;
    assert!(
        resp.status().is_client_error(),
        "Expected client error for wrong turn, got {}",
        resp.status()
    );
}

#[tokio::test]
async fn non_player_cannot_play() {
    let server = LightServer::start().await;
    let game_id = server.create_and_join().await;

    let resp = server
        .request(
            Method::POST,
            &format!("/api/games/{game_id}/play"),
            "test-spectator-api-token-99999",
            Some(&json!({"col": 0, "row": 0})),
        )
        .await;
    assert!(resp.status().is_client_error());
}

#[tokio::test]
async fn play_on_nonexistent_game_returns_404() {
    let server = LightServer::start().await;

    let resp = server
        .request(
            Method::POST,
            "/api/games/99999/play",
            "test-black-api-token-12345",
            Some(&json!({"col": 0, "row": 0})),
        )
        .await;
    assert_eq!(resp.status(), 404);
}

#[tokio::test]
async fn json_error_responses_have_structured_error_envelope() {
    let server = LightServer::start().await;

    // 404
    let resp = server
        .request(
            Method::GET,
            "/api/games/99999",
            "test-black-api-token-12345",
            None,
        )
        .await;
    let body: Value = resp.json().await.unwrap();
    assert!(
        body["error"].is_object(),
        "404 response should have structured error field: {body}"
    );
    assert_eq!(body["error"]["code"], "not_found");
    assert!(body["error"]["message"].is_string());

    // 401
    let resp = server.request_no_auth(Method::GET, "/api/me", None).await;
    let body: Value = resp.json().await.unwrap();
    assert!(
        body["error"].is_object(),
        "401 response should have structured error field: {body}"
    );
    assert_eq!(body["error"]["code"], "unauthorized");
    assert!(body["error"]["message"].is_string());

    // 422
    let resp = server.try_create_game_with(json!({"komi": 0})).await;
    let body: Value = resp.json().await.unwrap();
    assert!(
        body["error"].is_object(),
        "422 response should have structured error field: {body}"
    );
    assert_eq!(body["error"]["code"], "validation_error");
    assert!(body["error"]["message"].is_string());
}

// ============================================================
// Board dimension clamping — 2-41 inclusive
// ============================================================

#[tokio::test]
async fn reject_board_dimensions_outside_range() {
    let server = LightServer::start().await;

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
    let server = LightServer::start().await;

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
    let server = LightServer::start().await;
    let game_id = server.create_challenge().await;

    let resp = server
        .request(
            Method::POST,
            &format!("/api/games/{game_id}/accept"),
            "test-white-api-token-67890",
            None,
        )
        .await;
    assert!(
        resp.status().is_success(),
        "accept_challenge failed: {}",
        resp.status()
    );
    let body: Value = resp.json().await.unwrap();
    assert_eq!(body["status"], "accepted");

    let resp = server
        .request(
            Method::GET,
            &format!("/api/games/{game_id}"),
            "test-black-api-token-12345",
            None,
        )
        .await;
    let game: Value = resp.json().await.unwrap();
    let stage = game["stage"].as_str().unwrap();
    assert!(
        stage == "black_to_play" || stage == "white_to_play",
        "Expected playing stage after accept, got: {stage}"
    );
}

#[tokio::test]
async fn accept_challenge_game_is_playable() {
    let server = LightServer::start().await;
    let game_id = server.create_challenge().await;

    server
        .request(
            Method::POST,
            &format!("/api/games/{game_id}/accept"),
            "test-white-api-token-67890",
            None,
        )
        .await;

    let resp = server
        .request(
            Method::POST,
            &format!("/api/games/{game_id}/play"),
            "test-black-api-token-12345",
            Some(&json!({"col": 4, "row": 4})),
        )
        .await;
    assert!(
        resp.status().is_success(),
        "Should be able to play after accepting challenge: {}",
        resp.status()
    );
}

#[tokio::test]
async fn creator_cannot_accept_own_challenge() {
    let server = LightServer::start().await;
    let game_id = server.create_challenge().await;

    let resp = server
        .request(
            Method::POST,
            &format!("/api/games/{game_id}/accept"),
            "test-black-api-token-12345",
            None,
        )
        .await;
    assert!(
        resp.status().is_client_error(),
        "Creator should not be able to accept own challenge"
    );
}

#[tokio::test]
async fn non_participant_cannot_accept_challenge() {
    let server = LightServer::start().await;
    let game_id = server.create_challenge().await;

    let resp = server
        .request(
            Method::POST,
            &format!("/api/games/{game_id}/accept"),
            "test-spectator-api-token-99999",
            None,
        )
        .await;
    assert!(
        resp.status().is_client_error(),
        "Non-participant should not be able to accept challenge"
    );
}

#[tokio::test]
async fn cannot_accept_non_challenge_game() {
    let server = LightServer::start().await;
    let game_id = server.create_and_join().await;

    let resp = server
        .request(
            Method::POST,
            &format!("/api/games/{game_id}/accept"),
            "test-white-api-token-67890",
            None,
        )
        .await;
    assert!(
        resp.status().is_client_error(),
        "Should not accept a game that is not in challenge state"
    );
}

#[tokio::test]
async fn cannot_accept_already_accepted_challenge() {
    let server = LightServer::start().await;
    let game_id = server.create_challenge().await;

    server
        .request(
            Method::POST,
            &format!("/api/games/{game_id}/accept"),
            "test-white-api-token-67890",
            None,
        )
        .await;

    let resp = server
        .request(
            Method::POST,
            &format!("/api/games/{game_id}/accept"),
            "test-white-api-token-67890",
            None,
        )
        .await;
    assert!(
        resp.status().is_client_error(),
        "Should not accept an already accepted challenge"
    );
}

#[tokio::test]
async fn decline_challenge_via_api() {
    let server = LightServer::start().await;
    let game_id = server.create_challenge().await;

    let resp = server
        .request(
            Method::POST,
            &format!("/api/games/{game_id}/decline"),
            "test-white-api-token-67890",
            None,
        )
        .await;
    assert!(
        resp.status().is_success(),
        "decline_challenge failed: {}",
        resp.status()
    );
    let body: Value = resp.json().await.unwrap();
    assert_eq!(body["status"], "declined");

    let resp = server
        .request(
            Method::GET,
            &format!("/api/games/{game_id}"),
            "test-black-api-token-12345",
            None,
        )
        .await;
    let game: Value = resp.json().await.unwrap();
    assert_eq!(game["stage"], "declined");
    assert_eq!(game["result"], "Declined");
}

#[tokio::test]
async fn creator_cannot_decline_own_challenge() {
    let server = LightServer::start().await;
    let game_id = server.create_challenge().await;

    let resp = server
        .request(
            Method::POST,
            &format!("/api/games/{game_id}/decline"),
            "test-black-api-token-12345",
            None,
        )
        .await;
    assert!(
        resp.status().is_client_error(),
        "Creator should not be able to decline own challenge"
    );
}

#[tokio::test]
async fn non_participant_cannot_decline_challenge() {
    let server = LightServer::start().await;
    let game_id = server.create_challenge().await;

    let resp = server
        .request(
            Method::POST,
            &format!("/api/games/{game_id}/decline"),
            "test-spectator-api-token-99999",
            None,
        )
        .await;
    assert!(
        resp.status().is_client_error(),
        "Non-participant should not be able to decline challenge"
    );
}

#[tokio::test]
async fn cannot_decline_non_challenge_game() {
    let server = LightServer::start().await;
    let game_id = server.create_and_join().await;

    let resp = server
        .request(
            Method::POST,
            &format!("/api/games/{game_id}/decline"),
            "test-white-api-token-67890",
            None,
        )
        .await;
    assert!(
        resp.status().is_client_error(),
        "Should not decline a game that is not in challenge state"
    );
}

#[tokio::test]
async fn cannot_decline_already_declined_challenge() {
    let server = LightServer::start().await;
    let game_id = server.create_challenge().await;

    server
        .request(
            Method::POST,
            &format!("/api/games/{game_id}/decline"),
            "test-white-api-token-67890",
            None,
        )
        .await;

    let resp = server
        .request(
            Method::POST,
            &format!("/api/games/{game_id}/decline"),
            "test-white-api-token-67890",
            None,
        )
        .await;
    assert!(
        resp.status().is_client_error(),
        "Should not decline an already declined challenge"
    );
}

#[tokio::test]
async fn cannot_accept_declined_challenge() {
    let server = LightServer::start().await;
    let game_id = server.create_challenge().await;

    server
        .request(
            Method::POST,
            &format!("/api/games/{game_id}/decline"),
            "test-white-api-token-67890",
            None,
        )
        .await;

    let resp = server
        .request(
            Method::POST,
            &format!("/api/games/{game_id}/accept"),
            "test-white-api-token-67890",
            None,
        )
        .await;
    assert!(
        resp.status().is_client_error(),
        "Should not accept an already declined challenge"
    );
}

#[tokio::test]
async fn accept_challenge_on_nonexistent_game_returns_404() {
    let server = LightServer::start().await;

    let resp = server
        .request(
            Method::POST,
            "/api/games/99999/accept",
            "test-white-api-token-67890",
            None,
        )
        .await;
    assert_eq!(resp.status(), 404);
}

#[tokio::test]
async fn decline_challenge_on_nonexistent_game_returns_404() {
    let server = LightServer::start().await;

    let resp = server
        .request(
            Method::POST,
            "/api/games/99999/decline",
            "test-white-api-token-67890",
            None,
        )
        .await;
    assert_eq!(resp.status(), 404);
}

#[tokio::test]
async fn accept_challenge_requires_auth() {
    let server = LightServer::start().await;
    let game_id = server.create_challenge().await;

    let resp = server
        .request_no_auth(Method::POST, &format!("/api/games/{game_id}/accept"), None)
        .await;
    assert_eq!(resp.status(), 401);
}

#[tokio::test]
async fn decline_challenge_requires_auth() {
    let server = LightServer::start().await;
    let game_id = server.create_challenge().await;

    let resp = server
        .request_no_auth(Method::POST, &format!("/api/games/{game_id}/decline"), None)
        .await;
    assert_eq!(resp.status(), 401);
}

// ============================================================
// Territory Review
// ============================================================

#[tokio::test]
async fn toggle_chain_via_api() {
    let server = LightServer::start().await;
    let game_id = server.enter_territory_review().await;

    let resp = server
        .request(
            Method::POST,
            &format!("/api/games/{game_id}/territory/toggle"),
            "test-black-api-token-12345",
            Some(&json!({"col": 0, "row": 0})),
        )
        .await;
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
    let server = LightServer::start().await;
    let game_id = server.enter_territory_review().await;

    let resp = server
        .request(
            Method::POST,
            &format!("/api/games/{game_id}/territory/approve"),
            "test-black-api-token-12345",
            None,
        )
        .await;
    assert!(
        resp.status().is_success(),
        "black approve failed: {}",
        resp.status()
    );
    let body: Value = resp.json().await.unwrap();
    assert_eq!(body["territory"]["black_approved"], true);
    assert_eq!(body["territory"]["white_approved"], false);
    assert_eq!(body["stage"], "territory_review");

    let resp = server
        .request(
            Method::POST,
            &format!("/api/games/{game_id}/territory/approve"),
            "test-white-api-token-67890",
            None,
        )
        .await;
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
    let server = LightServer::start().await;
    let game_id = server.create_and_join().await;

    // Play stones so there's something to toggle in territory review
    let resp = server
        .request(
            Method::POST,
            &format!("/api/games/{game_id}/play"),
            "test-black-api-token-12345",
            Some(&json!({"col": 0, "row": 0})),
        )
        .await;
    assert!(resp.status().is_success(), "black play failed");

    let resp = server
        .request(
            Method::POST,
            &format!("/api/games/{game_id}/play"),
            "test-white-api-token-67890",
            Some(&json!({"col": 8, "row": 8})),
        )
        .await;
    assert!(resp.status().is_success(), "white play failed");

    let resp = server
        .request(
            Method::POST,
            &format!("/api/games/{game_id}/pass"),
            "test-black-api-token-12345",
            None,
        )
        .await;
    assert!(resp.status().is_success(), "black pass failed");

    let resp = server
        .request(
            Method::POST,
            &format!("/api/games/{game_id}/pass"),
            "test-white-api-token-67890",
            None,
        )
        .await;
    assert!(resp.status().is_success(), "white pass failed");

    server
        .request(
            Method::POST,
            &format!("/api/games/{game_id}/territory/approve"),
            "test-black-api-token-12345",
            None,
        )
        .await;

    let resp = server
        .request(
            Method::POST,
            &format!("/api/games/{game_id}/territory/toggle"),
            "test-white-api-token-67890",
            Some(&json!({"col": 0, "row": 0})),
        )
        .await;
    assert!(resp.status().is_success());
    let body: Value = resp.json().await.unwrap();
    assert_eq!(body["territory"]["black_approved"], false);
    assert_eq!(body["territory"]["white_approved"], false);
    assert_eq!(body["stage"], "territory_review");
}

#[tokio::test]
async fn toggle_chain_outside_territory_review() {
    let server = LightServer::start().await;
    let game_id = server.create_and_join().await;

    let resp = server
        .request(
            Method::POST,
            &format!("/api/games/{game_id}/territory/toggle"),
            "test-black-api-token-12345",
            Some(&json!({"col": 0, "row": 0})),
        )
        .await;
    assert!(
        resp.status().is_client_error(),
        "toggle should fail outside territory review"
    );
    let body: Value = resp.json().await.unwrap();
    assert!(
        assert_api_error(&body, "validation_error").contains("territory review"),
        "expected territory review error, got: {}",
        body["error"]
    );
}

#[tokio::test]
async fn approve_territory_outside_territory_review() {
    let server = LightServer::start().await;
    let game_id = server.create_and_join().await;

    let resp = server
        .request(
            Method::POST,
            &format!("/api/games/{game_id}/territory/approve"),
            "test-black-api-token-12345",
            None,
        )
        .await;
    assert!(
        resp.status().is_client_error(),
        "approve should fail outside territory review"
    );
}

#[tokio::test]
async fn approve_territory_twice_returns_error() {
    let server = LightServer::start().await;
    let game_id = server.enter_territory_review().await;

    server
        .request(
            Method::POST,
            &format!("/api/games/{game_id}/territory/approve"),
            "test-black-api-token-12345",
            None,
        )
        .await;

    let resp = server
        .request(
            Method::POST,
            &format!("/api/games/{game_id}/territory/approve"),
            "test-black-api-token-12345",
            None,
        )
        .await;
    assert!(
        resp.status().is_client_error(),
        "double approve should fail"
    );
    let body: Value = resp.json().await.unwrap();
    assert!(
        assert_api_error(&body, "validation_error").contains("already approved"),
        "expected already approved error, got: {}",
        body["error"]
    );
}

#[tokio::test]
async fn non_player_cannot_toggle_chain() {
    let server = LightServer::start().await;
    let game_id = server.enter_territory_review().await;

    let resp = server
        .request(
            Method::POST,
            &format!("/api/games/{game_id}/territory/toggle"),
            "test-spectator-api-token-99999",
            Some(&json!({"col": 0, "row": 0})),
        )
        .await;
    assert!(
        resp.status().is_client_error(),
        "non-player should not be able to toggle chain"
    );
}

#[tokio::test]
async fn non_player_cannot_approve_territory() {
    let server = LightServer::start().await;
    let game_id = server.enter_territory_review().await;

    let resp = server
        .request(
            Method::POST,
            &format!("/api/games/{game_id}/territory/approve"),
            "test-spectator-api-token-99999",
            None,
        )
        .await;
    assert!(
        resp.status().is_client_error(),
        "non-player should not be able to approve territory"
    );
}

#[tokio::test]
async fn toggle_chain_requires_auth() {
    let server = LightServer::start().await;
    let game_id = server.enter_territory_review().await;

    let resp = server
        .request_no_auth(
            Method::POST,
            &format!("/api/games/{game_id}/territory/toggle"),
            Some(&json!({"col": 0, "row": 0})),
        )
        .await;
    assert_eq!(resp.status(), 401);
}

#[tokio::test]
async fn approve_territory_requires_auth() {
    let server = LightServer::start().await;
    let game_id = server.enter_territory_review().await;

    let resp = server
        .request_no_auth(
            Method::POST,
            &format!("/api/games/{game_id}/territory/approve"),
            None,
        )
        .await;
    assert_eq!(resp.status(), 401);
}

// ============================================================
// Auth: Registration — needs session cookies, keep on TestServer
// ============================================================

#[tokio::test]
async fn register_allows_anonymous_user_to_keep_current_username() {
    let server = TestServer::start().await;
    let client = reqwest::Client::builder()
        .cookie_store(true)
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .unwrap();

    let resp = client
        .get(format!("http://{}/api/auth/token", server.addr))
        .header("Accept", "application/json")
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);
    let body: Value = resp.json().await.unwrap();
    let user_id = body["user"]["id"].as_i64().unwrap();
    let username = body["user"]["display_name"].as_str().unwrap().to_string();

    let resp = client
        .post(format!("http://{}/register", server.addr))
        .header("Accept", "application/json")
        .form(&[
            ("username", username.as_str()),
            ("password", "testpassword"),
            ("password_confirmation", "testpassword"),
        ])
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);

    let row: (String, bool) =
        sqlx::query_as("SELECT username, password_hash IS NOT NULL FROM users WHERE id = $1")
            .bind(user_id)
            .fetch_one(&server.pool)
            .await
            .unwrap();
    assert_eq!(row.0, username);
    assert!(row.1);
}

#[tokio::test]
async fn register_preserves_anonymous_player_identity_for_existing_game() {
    let server = TestServer::start().await;
    let client = reqwest::Client::builder()
        .cookie_store(true)
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .unwrap();

    let resp = client
        .get(format!("http://{}/api/auth/token", server.addr))
        .header("Accept", "application/json")
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);
    let body: Value = resp.json().await.unwrap();
    let user_id = body["user"]["id"].as_i64().unwrap();

    let resp = client
        .post(format!("http://{}/games", server.addr))
        .header("Accept", "application/json")
        .form(&[
            ("cols", "9"),
            ("variant", "challenge"),
            ("invite_username", "test-white"),
            ("komi", "6.5"),
            ("handicap", "0"),
            ("color", "black"),
        ])
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);
    let body: Value = resp.json().await.unwrap();
    let redirect = body["redirect"].as_str().unwrap();
    let game_id: i64 = redirect.trim_start_matches("/games/").parse().unwrap();

    let before: (Option<i64>, Option<i64>, Option<i64>) =
        sqlx::query_as("SELECT creator_id, black_id, white_id FROM games WHERE id = $1")
            .bind(game_id)
            .fetch_one(&server.pool)
            .await
            .unwrap();
    assert_eq!(before.0, Some(user_id));
    assert!(before.1 == Some(user_id) || before.2 == Some(user_id));

    let resp = client
        .post(format!("http://{}/register", server.addr))
        .header("Accept", "application/json")
        .form(&[
            ("username", "upgraded-player"),
            ("password", "testpassword"),
            ("password_confirmation", "testpassword"),
        ])
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);

    let after: (Option<i64>, Option<i64>, Option<i64>) =
        sqlx::query_as("SELECT creator_id, black_id, white_id FROM games WHERE id = $1")
            .bind(game_id)
            .fetch_one(&server.pool)
            .await
            .unwrap();
    assert_eq!(after, before);

    let resp = client
        .get(format!("http://{}/api/session/me", server.addr))
        .header("Accept", "application/json")
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);
    let body: Value = resp.json().await.unwrap();
    assert_eq!(body["id"], user_id);
    assert_eq!(body["display_name"], "upgraded-player");
    assert_eq!(body["is_registered"], true);
}

// ============================================================
// Auth: Logout — needs session cookies, keep on TestServer
// ============================================================

#[tokio::test]
async fn logout_html_redirects() {
    let server = TestServer::start().await;

    let resp = server
        .client_black
        .post(format!("http://{}/logout", server.addr))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 303);
}

#[tokio::test]
async fn logout_json_returns_redirect_field() {
    let server = TestServer::start().await;

    let resp = server
        .client_black
        .post(format!("http://{}/logout", server.addr))
        .header("Accept", "application/json")
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);
    let body: Value = resp.json().await.unwrap();
    assert!(
        body["redirect"].is_string(),
        "expected redirect field in JSON response"
    );
}
