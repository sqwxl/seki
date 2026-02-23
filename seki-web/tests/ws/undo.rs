use crate::common::TestServer;
use serde_json::json;

/// 6.1 + 6.2 -- Request undo, accept, verify rollback.
///
/// Black plays (3,3), requests undo, white accepts.
/// Both receive undo_accepted with the stone removed from the board.
#[tokio::test]
async fn request_undo_accept_rollback() {
    let server = TestServer::start().await;
    let game_id = server.create_and_join_with(json!({"allow_undo": true})).await;

    let mut black = server.ws_black().await;
    let mut white = server.ws_white().await;

    let _state = black.join_game(game_id).await;
    let _state = white.join_game(game_id).await;

    // Black plays (3,3)
    black.play(game_id, 3, 3).await;
    let state_b = black.recv_kind("state").await;
    let state_w = white.recv_kind("state").await;

    // Verify stone is on the board: index = 3*9 + 3 = 30
    let board = state_b["state"]["board"].as_array().unwrap();
    assert_eq!(board[30], 1, "expected black stone at (3,3)");
    assert_eq!(state_w["stage"], "white_to_play");

    // Black requests undo
    black.request_undo(game_id).await;

    // Black gets undo_request_sent
    let sent = black.recv_kind("undo_request_sent").await;
    assert_eq!(sent["game_id"], game_id);

    // White gets undo_response_needed
    let needed = white.recv_kind("undo_response_needed").await;
    assert_eq!(needed["game_id"], game_id);
    assert!(needed["requesting_player"].as_str().is_some());

    // White accepts the undo
    white.respond_undo(game_id, true).await;

    // Both get undo_accepted with reverted board
    let accepted_b = black.recv_kind("undo_accepted").await;
    let accepted_w = white.recv_kind("undo_accepted").await;

    assert_eq!(accepted_b["game_id"], game_id);
    assert_eq!(accepted_w["game_id"], game_id);

    // Board should no longer have the stone at (3,3)
    let board_b = accepted_b["state"]["board"].as_array().unwrap();
    assert_eq!(board_b[30], 0, "stone at (3,3) should be removed after undo");

    let board_w = accepted_w["state"]["board"].as_array().unwrap();
    assert_eq!(board_w[30], 0, "stone at (3,3) should be removed after undo");
}

/// 6.3 -- Reject undo: board retains the stone.
#[tokio::test]
async fn reject_undo() {
    let server = TestServer::start().await;
    let game_id = server.create_and_join_with(json!({"allow_undo": true})).await;

    let mut black = server.ws_black().await;
    let mut white = server.ws_white().await;

    let _state = black.join_game(game_id).await;
    let _state = white.join_game(game_id).await;

    // Black plays (3,3)
    black.play(game_id, 3, 3).await;
    let _ = black.recv_kind("state").await;
    let _ = white.recv_kind("state").await;

    // Black requests undo
    black.request_undo(game_id).await;
    let _ = black.recv_kind("undo_request_sent").await;
    let _ = white.recv_kind("undo_response_needed").await;

    // White rejects
    white.respond_undo(game_id, false).await;

    // Both get undo_rejected
    let rejected_b = black.recv_kind("undo_rejected").await;
    let rejected_w = white.recv_kind("undo_rejected").await;

    assert_eq!(rejected_b["game_id"], game_id);
    assert_eq!(rejected_w["game_id"], game_id);

    // Board still has the stone at (3,3)
    let board_b = rejected_b["state"]["board"].as_array().unwrap();
    assert_eq!(board_b[30], 1, "stone at (3,3) should still be present after rejection");

    let board_w = rejected_w["state"]["board"].as_array().unwrap();
    assert_eq!(board_w[30], 1, "stone at (3,3) should still be present after rejection");
}

/// 6.4 -- Undo disabled: requesting undo on a game without allow_undo yields an error.
#[tokio::test]
async fn undo_disabled() {
    let server = TestServer::start().await;
    // Default settings: allow_undo is false
    let game_id = server.create_and_join().await;

    let mut black = server.ws_black().await;
    let mut white = server.ws_white().await;

    let _state = black.join_game(game_id).await;
    let _state = white.join_game(game_id).await;

    // Black plays (3,3)
    black.play(game_id, 3, 3).await;
    let _ = black.recv_kind("state").await;
    let _ = white.recv_kind("state").await;

    // Black requests undo -- should fail
    black.request_undo(game_id).await;
    let err = black.recv_kind("error").await;
    assert!(err["message"].as_str().unwrap().len() > 0);
}

/// 6.5 -- Double undo request: second request while one is pending yields an error.
#[tokio::test]
async fn double_undo_request() {
    let server = TestServer::start().await;
    let game_id = server.create_and_join_with(json!({"allow_undo": true})).await;

    let mut black = server.ws_black().await;
    let mut white = server.ws_white().await;

    let _state = black.join_game(game_id).await;
    let _state = white.join_game(game_id).await;

    // Black plays (3,3)
    black.play(game_id, 3, 3).await;
    let _ = black.recv_kind("state").await;
    let _ = white.recv_kind("state").await;

    // First undo request -- succeeds
    black.request_undo(game_id).await;
    let _ = black.recv_kind("undo_request_sent").await;
    let _ = white.recv_kind("undo_response_needed").await;

    // Second undo request while pending -- should fail
    black.request_undo(game_id).await;
    let err = black.recv_kind("error").await;
    assert!(err["message"].as_str().unwrap().len() > 0);
}

/// 6.6 -- Undo blocked after rejection for the same move.
#[tokio::test]
async fn undo_blocked_after_rejection() {
    let server = TestServer::start().await;
    let game_id = server.create_and_join_with(json!({"allow_undo": true})).await;

    let mut black = server.ws_black().await;
    let mut white = server.ws_white().await;

    let _state = black.join_game(game_id).await;
    let _state = white.join_game(game_id).await;

    // Black plays (3,3)
    black.play(game_id, 3, 3).await;
    let _ = black.recv_kind("state").await;
    let _ = white.recv_kind("state").await;

    // Request undo
    black.request_undo(game_id).await;
    let _ = black.recv_kind("undo_request_sent").await;
    let _ = white.recv_kind("undo_response_needed").await;

    // White rejects
    white.respond_undo(game_id, false).await;
    let _ = black.recv_kind("undo_rejected").await;
    let _ = white.recv_kind("undo_rejected").await;

    // Black immediately requests undo again -- should fail (undo_rejected flag is set)
    black.request_undo(game_id).await;
    let err = black.recv_kind("error").await;
    assert!(err["message"].as_str().unwrap().len() > 0);
}

/// 6.7 -- Undo allowed after rejection + new moves clear the undo_rejected flag.
#[tokio::test]
async fn undo_allowed_after_rejection_and_new_moves() {
    let server = TestServer::start().await;
    let game_id = server.create_and_join_with(json!({"allow_undo": true})).await;

    let mut black = server.ws_black().await;
    let mut white = server.ws_white().await;

    let _state = black.join_game(game_id).await;
    let _state = white.join_game(game_id).await;

    // Black plays (3,3)
    black.play(game_id, 3, 3).await;
    let _ = black.recv_kind("state").await;
    let _ = white.recv_kind("state").await;

    // Request undo, get rejected
    black.request_undo(game_id).await;
    let _ = black.recv_kind("undo_request_sent").await;
    let _ = white.recv_kind("undo_response_needed").await;

    white.respond_undo(game_id, false).await;
    let _ = black.recv_kind("undo_rejected").await;
    let _ = white.recv_kind("undo_rejected").await;

    // White plays (5,5) -- clears undo_rejected flag
    white.play(game_id, 5, 5).await;
    let _ = black.recv_kind("state").await;
    let _ = white.recv_kind("state").await;

    // Black plays (4,4)
    black.play(game_id, 4, 4).await;
    let _ = black.recv_kind("state").await;
    let _ = white.recv_kind("state").await;

    // Black requests undo again -- should succeed now
    black.request_undo(game_id).await;

    let sent = black.recv_kind("undo_request_sent").await;
    assert_eq!(sent["game_id"], game_id);

    let needed = white.recv_kind("undo_response_needed").await;
    assert_eq!(needed["game_id"], game_id);
}

/// 6.8 -- Cannot undo a pass: only play moves are undoable.
#[tokio::test]
async fn cannot_undo_pass() {
    let server = TestServer::start().await;
    let game_id = server.create_and_join_with(json!({"allow_undo": true})).await;

    let mut black = server.ws_black().await;
    let mut white = server.ws_white().await;

    let _state = black.join_game(game_id).await;
    let _state = white.join_game(game_id).await;

    // Black passes
    black.pass(game_id).await;
    let _ = black.recv_kind("state").await;
    let _ = white.recv_kind("state").await;

    // Black requests undo -- should fail (can't undo a pass)
    black.request_undo(game_id).await;
    let err = black.recv_kind("error").await;
    assert!(err["message"].as_str().unwrap().len() > 0);
}

/// 6.9 -- Cannot undo opponent's move: can only undo your own last move.
#[tokio::test]
async fn cannot_undo_opponents_move() {
    let server = TestServer::start().await;
    let game_id = server.create_and_join_with(json!({"allow_undo": true})).await;

    let mut black = server.ws_black().await;
    let mut white = server.ws_white().await;

    let _state = black.join_game(game_id).await;
    let _state = white.join_game(game_id).await;

    // Black plays (3,3)
    black.play(game_id, 3, 3).await;
    let _ = black.recv_kind("state").await;
    let _ = white.recv_kind("state").await;

    // White plays (5,5)
    white.play(game_id, 5, 5).await;
    let _ = black.recv_kind("state").await;
    let _ = white.recv_kind("state").await;

    // Black requests undo -- should fail (last move was White's)
    black.request_undo(game_id).await;
    let err = black.recv_kind("error").await;
    assert!(err["message"].as_str().unwrap().len() > 0);
}
