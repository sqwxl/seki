use serde_json::Value;

use crate::common::{TestServer, WsClient};

/// Helper: play two consecutive passes and consume all resulting messages,
/// returning the territory review state as seen by black.
///
/// Before calling, both clients must have already joined the game room.
/// After returning, both streams are drained of pass-related messages.
async fn enter_territory_review(game_id: i64, black: &mut WsClient, white: &mut WsClient) -> Value {
    // Black passes
    black.pass(game_id).await;
    let _ = black.recv_kind("state").await;
    let _ = white.recv_kind("state").await;

    // White passes — triggers territory review
    white.pass(game_id).await;

    // Each player receives a chat and a state message (order may vary).
    // Use recv_kind to find each without assuming order.
    let _ = black.recv_kind("chat").await;
    let b_state = black.recv_kind("state").await;
    let _ = white.recv_kind("chat").await;
    let _ = white.recv_kind("state").await;

    assert_eq!(b_state["stage"], "territory_review");
    b_state
}

/// 7.1 — Toggle dead chain: toggling a stone updates territory and resets approvals.
#[tokio::test]
async fn toggle_dead_chain() {
    let server = TestServer::start().await;
    let game_id = server.create_and_join().await;

    let mut black = server.ws_black().await;
    let mut white = server.ws_white().await;

    let _state = black.join_game(game_id).await;
    let _state = white.join_game(game_id).await;

    // Play some stones so there's something to toggle
    // B(0,0)
    black.play(game_id, 0, 0).await;
    let _ = black.recv_kind("state").await;
    let _ = white.recv_kind("state").await;

    // W(8,8)
    white.play(game_id, 8, 8).await;
    let _ = black.recv_kind("state").await;
    let _ = white.recv_kind("state").await;

    // Enter territory review via two passes
    let state = enter_territory_review(game_id, &mut black, &mut white).await;

    // Verify territory is present
    assert!(
        state.get("territory").is_some() && !state["territory"].is_null(),
        "expected territory field in state"
    );

    // Black toggles the stone at (0,0)
    black.toggle_chain(game_id, 0, 0).await;

    let state_b = black.recv_kind("state").await;
    let state_w = white.recv_kind("state").await;

    // Both approvals should be false after a toggle
    assert_eq!(
        state_b["territory"]["black_approved"], false,
        "black_approved should be false after toggle"
    );
    assert_eq!(
        state_b["territory"]["white_approved"], false,
        "white_approved should be false after toggle"
    );
    assert_eq!(
        state_w["territory"]["black_approved"], false,
        "white's view: black_approved should be false after toggle"
    );
    assert_eq!(
        state_w["territory"]["white_approved"], false,
        "white's view: white_approved should be false after toggle"
    );
}

/// 7.3 — Both approve, game ends with a score result.
#[tokio::test]
async fn both_approve_game_ends() {
    let server = TestServer::start().await;
    let game_id = server.create_and_join().await;

    let mut black = server.ws_black().await;
    let mut white = server.ws_white().await;

    let _state = black.join_game(game_id).await;
    let _state = white.join_game(game_id).await;

    // Enter territory review on an empty board (two passes, no moves)
    enter_territory_review(game_id, &mut black, &mut white).await;

    // Black approves
    black.approve_territory(game_id).await;

    let state_b = black.recv_kind("state").await;
    let state_w = white.recv_kind("state").await;

    assert_eq!(
        state_b["territory"]["black_approved"], true,
        "black_approved should be true after black approves"
    );
    assert_eq!(
        state_b["territory"]["white_approved"], false,
        "white_approved should still be false"
    );
    assert_eq!(state_b["stage"], "territory_review");

    assert_eq!(state_w["territory"]["black_approved"], true);
    assert_eq!(state_w["territory"]["white_approved"], false);

    // White approves — both approved, game should end
    white.approve_territory(game_id).await;

    // When game ends, a system chat is broadcast too. Consume via recv_kind.
    let _ = black.recv_kind("chat").await;
    let state_b = black.recv_kind("state").await;
    let _ = white.recv_kind("chat").await;
    let state_w = white.recv_kind("state").await;

    assert_eq!(
        state_b["stage"], "done",
        "game should be done after both approve"
    );
    assert_eq!(state_w["stage"], "done");

    // Result should be a score string. With empty board and komi 0.5, white wins.
    let result_b = state_b["result"]
        .as_str()
        .expect("result should be a string");
    assert!(
        result_b.contains('+'),
        "result should be a score like 'W+0.5', got: {result_b}"
    );
    // Default komi is 0.5, empty board → W+0.5
    assert_eq!(
        result_b, "W+0.5",
        "empty board with 0.5 komi should be W+0.5"
    );

    let result_w = state_w["result"]
        .as_str()
        .expect("result should be a string");
    assert_eq!(
        result_w, result_b,
        "both players should see the same result"
    );
}

/// 7.4 — Approval reset on toggle: after one player approves, a toggle resets both approvals.
#[tokio::test]
async fn approval_reset_on_toggle() {
    let server = TestServer::start().await;
    let game_id = server.create_and_join().await;

    let mut black = server.ws_black().await;
    let mut white = server.ws_white().await;

    let _state = black.join_game(game_id).await;
    let _state = white.join_game(game_id).await;

    // Play some stones so we have something to toggle
    // B(0,0)
    black.play(game_id, 0, 0).await;
    let _ = black.recv_kind("state").await;
    let _ = white.recv_kind("state").await;

    // W(8,8)
    white.play(game_id, 8, 8).await;
    let _ = black.recv_kind("state").await;
    let _ = white.recv_kind("state").await;

    // Enter territory review
    enter_territory_review(game_id, &mut black, &mut white).await;

    // Black approves
    black.approve_territory(game_id).await;

    let state_b = black.recv_kind("state").await;
    let state_w = white.recv_kind("state").await;

    assert_eq!(state_b["territory"]["black_approved"], true);
    assert_eq!(state_b["territory"]["white_approved"], false);
    assert_eq!(state_w["territory"]["black_approved"], true);

    // White toggles a stone — should reset BOTH approvals
    white.toggle_chain(game_id, 0, 0).await;

    let state_b = black.recv_kind("state").await;
    let state_w = white.recv_kind("state").await;

    assert_eq!(
        state_b["territory"]["black_approved"], false,
        "black_approved should be reset to false after toggle"
    );
    assert_eq!(
        state_b["territory"]["white_approved"], false,
        "white_approved should be reset to false after toggle"
    );
    assert_eq!(
        state_w["territory"]["black_approved"], false,
        "white's view: black_approved should be false"
    );
    assert_eq!(
        state_w["territory"]["white_approved"], false,
        "white's view: white_approved should be false"
    );

    // Stage should still be territory_review, not done
    assert_eq!(state_b["stage"], "territory_review");
    assert_eq!(state_w["stage"], "territory_review");
}

/// 7.7 — Toggle outside territory review: toggling when game is in play stage returns an error.
#[tokio::test]
async fn toggle_outside_territory_review() {
    let server = TestServer::start().await;
    let game_id = server.create_and_join().await;

    let mut black = server.ws_black().await;
    let mut white = server.ws_white().await;

    let state = black.join_game(game_id).await;
    assert_eq!(state["stage"], "black_to_play");
    let _state = white.join_game(game_id).await;

    // Black tries to toggle a chain while the game is in play stage
    black.toggle_chain(game_id, 4, 4).await;

    let err = black.recv_kind("error").await;
    assert!(
        err["message"]
            .as_str()
            .unwrap()
            .contains("Not in territory review"),
        "expected 'Not in territory review' error, got: {}",
        err["message"]
    );
}
