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

/// Player disconnects → opponent receives `player_disconnected` with `grace_period_ms`.
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

    // White should receive player_disconnected with grace_period_ms
    let msg = white.recv_kind("player_disconnected").await;
    assert_eq!(msg["user_id"], server.black_id);
    assert!(msg["timestamp"].is_string());
    // grace_period_ms should be present (capped to 100ms by test registry)
    assert!(
        msg["grace_period_ms"].is_number(),
        "Expected grace_period_ms, got: {}",
        msg
    );
}

/// Clock keeps running on disconnect (active_stone is NOT null).
#[tokio::test]
async fn clock_keeps_running_on_disconnect() {
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
    tokio::time::sleep(Duration::from_millis(50)).await;

    // Drain disconnect message from black's perspective
    let _ = black.recv_kind("player_disconnected").await;

    // Re-join black to get fresh state (while white is still disconnected)
    let mut black2 = server.ws_black().await;
    let state = black2.join_game(game_id).await;

    // Clock should still be running (active_stone NOT null)
    assert_eq!(
        state["clock"]["active_stone"], -1,
        "Expected clock still running (active_stone = -1), got: {}",
        state["clock"]["active_stone"]
    );
}

/// Player reconnects → opponent receives `player_reconnected`, no `player_gone` fires.
#[tokio::test]
async fn reconnect_cancels_grace_and_no_gone() {
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
    tokio::time::sleep(Duration::from_millis(50)).await;

    // Black should see player_disconnected
    let msg = black.recv_kind("player_disconnected").await;
    assert_eq!(msg["user_id"], server.white_id);

    // White reconnects quickly (before grace expires)
    let mut white2 = server.ws_white().await;

    // Black should see player_reconnected
    let msg = black.recv_kind("player_reconnected").await;
    assert_eq!(msg["user_id"], server.white_id);

    // White joins and sees running clock
    let state = white2.join_game(game_id).await;
    assert_eq!(
        state["clock"]["active_stone"], -1,
        "Clock should still be running for white after reconnect"
    );
}

/// Move while opponent disconnected → clock keeps running.
#[tokio::test]
async fn move_while_opponent_disconnected_clock_keeps_running() {
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

    // Black plays — white's clock should start ticking even though they're disconnected
    black.play(game_id, 0, 0).await;
    let state = black.recv_kind("state").await;

    assert_eq!(
        state["clock"]["active_stone"], -1,
        "Clock should keep running when opponent is disconnected, got: {}",
        state["clock"]["active_stone"]
    );
}

/// `player_gone` is broadcast after the grace period expires.
#[tokio::test]
async fn player_gone_broadcast_after_grace() {
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
    tokio::time::sleep(Duration::from_millis(50)).await;

    // Black sees player_disconnected
    let _ = black.recv_kind("player_disconnected").await;

    // Wait for the grace period to expire (100ms in test registry + buffer)
    tokio::time::sleep(Duration::from_millis(200)).await;

    // Black should see player_gone
    let msg = black.recv_kind("player_gone").await;
    assert_eq!(msg["user_id"], server.white_id);
}

/// Claim victory succeeds after player is gone.
#[tokio::test]
async fn claim_victory_succeeds_after_player_gone() {
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
    tokio::time::sleep(Duration::from_millis(50)).await;

    let _ = black.recv_kind("player_disconnected").await;

    // Wait for gone
    tokio::time::sleep(Duration::from_millis(200)).await;
    let _ = black.recv_kind("player_gone").await;

    // Black claims victory
    black.claim_victory(game_id).await;

    // Should get chat + state messages indicating game is over
    let state = black.recv_kind("state").await;
    assert_eq!(
        state["result"].as_str().unwrap(),
        "B+R",
        "Expected B+R result"
    );
}

/// Claim victory rejected before player is gone.
#[tokio::test]
async fn claim_victory_rejected_before_player_gone() {
    let server = TestServer::start().await;
    let game_id = create_timed_game(&server).await;

    let mut black = server.ws_black().await;
    let mut white = server.ws_white().await;

    let _state = black.join_game(game_id).await;
    let _state = white.join_game(game_id).await;

    // Both play a move
    black.play(game_id, 0, 0).await;
    let _ = black.recv_kind("state").await;
    let _ = white.recv_kind("state").await;

    white.play(game_id, 1, 0).await;
    let _ = black.recv_kind("state").await;
    let _ = white.recv_kind("state").await;

    // White disconnects
    white.close().await;
    tokio::time::sleep(Duration::from_millis(50)).await;
    let _ = black.recv_kind("player_disconnected").await;

    // Immediately try to claim victory — should be rejected (not gone yet)
    black.claim_victory(game_id).await;
    let err = black.recv_kind("error").await;
    assert!(
        err["message"]
            .as_str()
            .unwrap()
            .contains("not been gone long enough"),
        "Expected rejection, got: {}",
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
