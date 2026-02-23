use crate::common::TestServer;

/// 12.1 — Player sends chat: both players receive the broadcast.
#[tokio::test]
async fn player_sends_chat() {
    let server = TestServer::start().await;
    let game_id = server.create_and_join().await;

    let mut black = server.ws_black().await;
    let mut white = server.ws_white().await;

    let _state = black.join_game(game_id).await;
    let _state = white.join_game(game_id).await;

    black.chat(game_id, "hello").await;

    let msg_b = black.recv_kind("chat").await;
    let msg_w = white.recv_kind("chat").await;

    assert_eq!(msg_b["text"], "hello");
    assert_eq!(msg_b["game_id"], game_id);
    assert!(
        !msg_b["player_id"].is_null(),
        "player chat should have non-null player_id"
    );
    assert_eq!(msg_b["display_name"], "test-black");

    assert_eq!(msg_w["text"], "hello");
    assert_eq!(msg_w["game_id"], game_id);
    assert!(
        !msg_w["player_id"].is_null(),
        "player chat should have non-null player_id"
    );
    assert_eq!(msg_w["display_name"], "test-black");
}

/// 12.2 — Empty message rejected: sender gets error, opponent gets nothing.
#[tokio::test]
async fn empty_message_rejected() {
    let server = TestServer::start().await;
    let game_id = server.create_and_join().await;

    let mut black = server.ws_black().await;
    let mut white = server.ws_white().await;

    let _state = black.join_game(game_id).await;
    let _state = white.join_game(game_id).await;

    black.chat(game_id, "").await;

    let err = black.recv_kind("error").await;
    assert!(
        err["message"]
            .as_str()
            .unwrap()
            .to_lowercase()
            .contains("empty"),
        "expected error about empty message, got: {}",
        err["message"]
    );

    // White should NOT receive anything for the failed chat.
    // Verify by having white send a valid chat and confirming
    // that white's next message is that chat broadcast, not an error.
    white.chat(game_id, "ping").await;
    let msg_w = white.recv_kind("chat").await;
    assert_eq!(msg_w["text"], "ping");
}

/// 12.3 — Message too long: sender gets error.
#[tokio::test]
async fn message_too_long() {
    let server = TestServer::start().await;
    let game_id = server.create_and_join().await;

    let mut black = server.ws_black().await;

    let _state = black.join_game(game_id).await;

    let long_msg = "x".repeat(1001);
    black.chat(game_id, &long_msg).await;

    let err = black.recv_kind("error").await;
    assert!(
        err["message"]
            .as_str()
            .unwrap()
            .to_lowercase()
            .contains("too long"),
        "expected error about message length, got: {}",
        err["message"]
    );
}

/// 12.4 — System chats appear on territory review (two consecutive passes).
#[tokio::test]
async fn system_chat_on_territory_review() {
    let server = TestServer::start().await;
    let game_id = server.create_and_join().await;

    let mut black = server.ws_black().await;
    let mut white = server.ws_white().await;

    let _state = black.join_game(game_id).await;
    let _state = white.join_game(game_id).await;

    // Black passes
    black.pass(game_id).await;
    let _ = black.recv_kind("state").await;
    let _ = white.recv_kind("state").await;

    // White passes — triggers territory review
    white.pass(game_id).await;

    // After two passes, each player receives a state update and a system chat
    // (in either order). Use recv_kind to find the chat.
    let chat_b = black.recv_kind("chat").await;
    let chat_w = white.recv_kind("chat").await;

    assert!(
        chat_b["player_id"].is_null(),
        "system chat should have null player_id"
    );
    let text_b = chat_b["text"].as_str().expect("chat should have text");
    assert!(
        text_b.contains("Territory review"),
        "expected territory review system chat, got: {text_b}"
    );

    assert!(
        chat_w["player_id"].is_null(),
        "system chat should have null player_id"
    );
    let text_w = chat_w["text"].as_str().expect("chat should have text");
    assert!(
        text_w.contains("Territory review"),
        "expected territory review system chat, got: {text_w}"
    );
}
