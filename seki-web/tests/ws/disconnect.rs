use std::time::Duration;

use serde_json::json;

use crate::common::TestServer;

/// Helper: create a Fischer-timed game and have both players join.
async fn create_timed_game(server: &TestServer) -> i64 {
    server
        .create_and_join_with(json!({
            "time_control": "fischer",
            "main_time_secs": 300,
            "increment_secs": 5,
        }))
        .await
}

/// Player disconnects → opponent receives `player_disconnected` message.
#[tokio::test]
async fn disconnect_broadcasts_player_disconnected() {
    let server = TestServer::start().await;
    let game_id = create_timed_game(&server).await;

    let mut black = server.ws_black().await;
    let mut white = server.ws_white().await;

    let _state = black.join_game(game_id).await;
    let _state = white.join_game(game_id).await;

    // Black makes a move so the game is active
    black.play(game_id, 0, 0).await;
    let _ = black.recv_kind("state").await;
    let _ = white.recv_kind("state").await;

    // Black disconnects (close WS)
    black.close().await;

    // Allow grace period to fire (0ms in tests, but need a small yield)
    tokio::time::sleep(Duration::from_millis(100)).await;

    // White should receive player_disconnected
    let msg = white.recv_kind("player_disconnected").await;
    assert_eq!(msg["user_id"], server.black_id);
    assert!(msg["timestamp"].is_string());
}

/// Clock pauses on disconnect (verify clock state has `active_stone: null`).
#[tokio::test]
async fn clock_pauses_on_disconnect() {
    let server = TestServer::start().await;
    let game_id = create_timed_game(&server).await;

    let mut black = server.ws_black().await;
    let mut white = server.ws_white().await;

    let _state = black.join_game(game_id).await;
    let _state = white.join_game(game_id).await;

    // Black plays, clock starts for white
    black.play(game_id, 0, 0).await;
    let state_w = white.recv_kind("state").await;
    // After black's move, white's clock should be active
    assert_eq!(state_w["clock"]["active_stone"], -1);
    let _ = black.recv_kind("state").await;

    // White disconnects
    white.close().await;
    tokio::time::sleep(Duration::from_millis(100)).await;

    // Drain disconnect message from black's perspective
    let _ = black.recv_kind("player_disconnected").await;

    // Re-join black to get fresh state (while white is still disconnected)
    let mut black2 = server.ws_black().await;
    let state = black2.join_game(game_id).await;

    // Clock should be paused (active_stone null) because white is disconnected
    assert!(
        state["clock"]["active_stone"].is_null(),
        "Expected paused clock (null active_stone), got: {}",
        state["clock"]["active_stone"]
    );
}

/// Player reconnects → opponent receives `player_reconnected`, clock resumes.
#[tokio::test]
async fn reconnect_broadcasts_player_reconnected_and_resumes_clock() {
    let server = TestServer::start().await;
    let game_id = create_timed_game(&server).await;

    let mut black = server.ws_black().await;
    let mut white = server.ws_white().await;

    let _state = black.join_game(game_id).await;
    let _state = white.join_game(game_id).await;

    // Black plays
    black.play(game_id, 0, 0).await;
    let _ = black.recv_kind("state").await;
    let _ = white.recv_kind("state").await;

    // White disconnects
    white.close().await;
    tokio::time::sleep(Duration::from_millis(100)).await;

    // Black should see player_disconnected
    let msg = black.recv_kind("player_disconnected").await;
    assert_eq!(msg["user_id"], server.white_id);

    // White reconnects
    let mut white2 = server.ws_white().await;

    // Black should see player_reconnected
    let msg = black.recv_kind("player_reconnected").await;
    assert_eq!(msg["user_id"], server.white_id);

    // White joins and sees resumed clock
    let state = white2.join_game(game_id).await;
    assert_eq!(
        state["clock"]["active_stone"], -1,
        "Clock should have resumed for white after reconnect"
    );
}

/// Move while opponent disconnected → clock stays paused.
#[tokio::test]
async fn move_while_opponent_disconnected_keeps_clock_paused() {
    let server = TestServer::start().await;
    let game_id = create_timed_game(&server).await;

    let mut black = server.ws_black().await;
    let mut white = server.ws_white().await;

    let _state = black.join_game(game_id).await;
    let _state = white.join_game(game_id).await;

    // White disconnects before any moves
    white.close().await;
    tokio::time::sleep(Duration::from_millis(100)).await;

    // Drain the disconnect message
    let _ = black.recv_kind("player_disconnected").await;

    // Black plays — since white is disconnected, white's clock should not start
    black.play(game_id, 0, 0).await;
    let state = black.recv_kind("state").await;

    assert!(
        state["clock"]["active_stone"].is_null(),
        "Clock should stay paused when opponent is disconnected, got: {}",
        state["clock"]["active_stone"]
    );
}

/// Disconnect abort rejected before threshold has elapsed.
#[tokio::test]
async fn disconnect_abort_rejected_before_threshold() {
    let server = TestServer::start().await;
    let game_id = create_timed_game(&server).await;

    let mut black = server.ws_black().await;
    let mut white = server.ws_white().await;

    let _state = black.join_game(game_id).await;
    let _state = white.join_game(game_id).await;

    // Both play a move so both have moved (15s threshold)
    black.play(game_id, 0, 0).await;
    let _ = black.recv_kind("state").await;
    let _ = white.recv_kind("state").await;

    white.play(game_id, 1, 0).await;
    let _ = black.recv_kind("state").await;
    let _ = white.recv_kind("state").await;

    // White disconnects
    white.close().await;
    tokio::time::sleep(Duration::from_millis(100)).await;
    let _ = black.recv_kind("player_disconnected").await;

    // The disconnect happened ~100ms ago, threshold is 15s. We can't wait that long
    // in a test, so verify the threshold rejection works correctly.
    black.disconnect_abort(game_id).await;
    let err = black.recv_kind("error").await;
    assert!(
        err["message"]
            .as_str()
            .unwrap()
            .contains("disconnected for at least"),
        "Expected threshold error, got: {}",
        err["message"]
    );
}

/// Disconnect abort before threshold → rejected.
#[tokio::test]
async fn disconnect_abort_before_threshold_rejected() {
    let server = TestServer::start().await;
    let game_id = create_timed_game(&server).await;

    let mut black = server.ws_black().await;
    let mut white = server.ws_white().await;

    let _state = black.join_game(game_id).await;
    let _state = white.join_game(game_id).await;

    // Black plays
    black.play(game_id, 0, 0).await;
    let _ = black.recv_kind("state").await;
    let _ = white.recv_kind("state").await;

    // White disconnects
    white.close().await;
    tokio::time::sleep(Duration::from_millis(100)).await;
    let _ = black.recv_kind("player_disconnected").await;

    // Try to abort immediately — should be rejected (threshold not reached)
    black.disconnect_abort(game_id).await;
    let err = black.recv_kind("error").await;
    assert!(
        err["message"]
            .as_str()
            .unwrap()
            .contains("disconnected for at least"),
        "Expected threshold rejection, got: {}",
        err["message"]
    );
}

/// Territory review is locked during disconnect.
#[tokio::test]
async fn territory_review_locked_during_disconnect() {
    let server = TestServer::start().await;
    let game_id = create_timed_game(&server).await;

    let mut black = server.ws_black().await;
    let mut white = server.ws_white().await;

    let _state = black.join_game(game_id).await;
    let _state = white.join_game(game_id).await;

    // Enter territory review: both pass
    black.pass(game_id).await;
    let _ = black.recv_kind("state").await;
    let _ = white.recv_kind("state").await;

    white.pass(game_id).await;
    // Skip chat + state messages
    let _ = black.recv_kind("state").await;
    let _ = white.recv_kind("state").await;

    // White disconnects
    white.close().await;
    tokio::time::sleep(Duration::from_millis(100)).await;
    let _ = black.recv_kind("player_disconnected").await;

    // Black tries to toggle a chain — should be rejected
    black.toggle_chain(game_id, 0, 0).await;
    let err = black.recv_kind("error").await;
    assert!(
        err["message"]
            .as_str()
            .unwrap()
            .contains("Opponent disconnected"),
        "Expected territory review locked error, got: {}",
        err["message"]
    );

    // Black tries to approve territory — should also be rejected
    black.approve_territory(game_id).await;
    let err = black.recv_kind("error").await;
    assert!(
        err["message"]
            .as_str()
            .unwrap()
            .contains("Opponent disconnected"),
        "Expected territory review locked error, got: {}",
        err["message"]
    );
}
