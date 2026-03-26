use serde_json::json;

use crate::common::{TestServer, api_error_message};

// -- Private Game Visibility --

#[tokio::test]
async fn private_game_not_visible_to_non_participant() {
    let server = TestServer::start().await;

    let game_id = server.create_private_game().await;

    // Spectator (non-participant) tries to view the private game
    let resp = server.get_game_as_spectator(game_id).await;
    assert_eq!(
        resp.status(),
        404,
        "Private game should not be visible to non-participant"
    );
}

#[tokio::test]
async fn private_game_visible_to_creator() {
    let server = TestServer::start().await;

    let game_id = server.create_private_game().await;

    // Creator can view their own private game
    let resp = server
        .client_black
        .get(format!("http://{}/api/games/{game_id}", server.addr))
        .header("Authorization", "Bearer test-black-api-token-12345")
        .send()
        .await
        .unwrap();
    assert!(
        resp.status().is_success(),
        "Creator should see their private game"
    );
}

#[tokio::test]
async fn private_game_visible_to_player() {
    let server = TestServer::start().await;

    let game_id = server.create_private_game().await;
    let token = server.get_access_token(game_id).await;

    // White joins with valid token
    let resp = server
        .client_white
        .post(format!("http://{}/api/games/{game_id}/join", server.addr))
        .header("Authorization", "Bearer test-white-api-token-67890")
        .json(&json!({"access_token": token}))
        .send()
        .await
        .unwrap();
    assert!(
        resp.status().is_success(),
        "White should be able to join with token: {}",
        resp.status()
    );

    // White can now view the game
    let resp = server
        .client_white
        .get(format!("http://{}/api/games/{game_id}", server.addr))
        .header("Authorization", "Bearer test-white-api-token-67890")
        .send()
        .await
        .unwrap();
    assert!(
        resp.status().is_success(),
        "Player should see the private game"
    );
}

// -- Private Game Join --

#[tokio::test]
async fn cannot_join_private_game_without_token() {
    let server = TestServer::start().await;

    let game_id = server.create_private_game().await;

    // Try to join without token
    let resp = server.join_game_as_spectator(game_id).await;
    assert_eq!(resp.status(), 422);
    assert!(api_error_message(resp).await.contains("access token"));
}

#[tokio::test]
async fn can_join_private_game_with_valid_token() {
    let server = TestServer::start().await;

    let game_id = server.create_private_game().await;
    let token = server.get_access_token(game_id).await;

    // Join with valid token
    let resp = server.join_private_game_as_spectator(game_id, &token).await;
    assert!(resp.status().is_success(), "Should join with valid token");
}

#[tokio::test]
async fn cannot_join_private_game_with_wrong_token() {
    let server = TestServer::start().await;

    let game_id = server.create_private_game().await;

    // Join with wrong token
    let resp = server
        .join_private_game_as_spectator(game_id, "wrong-token-12345")
        .await;
    assert_eq!(resp.status(), 422);
    assert!(api_error_message(resp).await.contains("access token"));
}

// -- Abort Access Control --

#[tokio::test]
async fn only_creator_can_abort_pending_challenge() {
    let server = TestServer::start().await;

    // Black creates, white joins
    let game_id = server.create_and_join().await;

    // White (non-creator) tries to abort via WS
    let mut ws_white = server.ws_white().await;
    ws_white.join_game(game_id).await;
    ws_white.abort(game_id).await;

    let msg = ws_white.recv_kind("error").await;
    assert!(
        msg["message"].as_str().unwrap_or("").contains("creator"),
        "Expected error about creator, got: {:?}",
        msg
    );
}

#[tokio::test]
async fn creator_can_abort_pending_challenge() {
    let server = TestServer::start().await;

    // Black creates, white joins
    let game_id = server.create_and_join().await;

    // Black (creator) can abort
    let mut ws_black = server.ws_black().await;
    ws_black.join_game(game_id).await;
    ws_black.abort(game_id).await;

    // Should receive a chat message about abort, then state update
    let msg = ws_black.recv_kind("state").await;
    assert_eq!(msg["result"], "Aborted");
}

// -- Private Game Chat --

#[tokio::test]
async fn non_participant_cannot_chat_in_private_game() {
    let server = TestServer::start().await;

    let game_id = server.create_private_game().await;

    // Spectator tries to send a chat message to the private game via API
    let resp = server
        .client_spectator
        .post(format!(
            "http://{}/api/games/{game_id}/messages",
            server.addr
        ))
        .header("Authorization", "Bearer test-spectator-api-token-99999")
        .json(&json!({"text": "Hello!"}))
        .send()
        .await
        .unwrap();

    assert_eq!(resp.status(), 422);
    assert!(api_error_message(resp).await.contains("private game"));
}

#[tokio::test]
async fn participant_can_chat_in_private_game() {
    let server = TestServer::start().await;

    let game_id = server.create_private_game().await;

    // Creator (participant) can chat
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

    assert!(
        resp.status().is_success(),
        "Participant should be able to chat"
    );
}

// -- Join Finished Game --

#[tokio::test]
async fn cannot_join_aborted_game() {
    let server = TestServer::start().await;

    let game_id = server.create_game().await;

    // Black aborts the game before anyone joins
    let mut ws_black = server.ws_black().await;
    ws_black.join_game(game_id).await;
    ws_black.abort(game_id).await;
    ws_black.recv_kind("state").await;

    // Spectator tries to join aborted game
    let resp = server.join_game_as_spectator(game_id).await;
    assert_eq!(resp.status(), 422);
    assert!(api_error_message(resp).await.contains("finished"));
}

#[tokio::test]
async fn cannot_join_completed_game() {
    let server = TestServer::start().await;

    let game_id = server.create_and_join().await;

    // Play a move and have black resign
    let mut ws_black = server.ws_black().await;
    let mut ws_white = server.ws_white().await;
    ws_black.join_game(game_id).await;
    ws_white.join_game(game_id).await;

    // Black plays, then resigns
    ws_black.play(game_id, 0, 0).await;
    ws_black.recv_kind("state").await;
    ws_white.recv_kind("state").await;

    ws_black.resign(game_id).await;
    ws_black.recv_kind("state").await;
    ws_white.recv_kind("state").await;

    // Spectator tries to join completed game
    let resp = server.join_game_as_spectator(game_id).await;
    assert_eq!(resp.status(), 422);
    assert!(api_error_message(resp).await.contains("finished"));
}
