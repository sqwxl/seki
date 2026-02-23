use crate::common::TestServer;

/// 5.1 -- Black resigns: both receive stage "done", result "White+R".
#[tokio::test]
async fn black_resigns() {
    let server = TestServer::start().await;
    let game_id = server.create_and_join().await;

    let mut black = server.ws_black().await;
    let mut white = server.ws_white().await;

    let _state = black.join_game(game_id).await;
    let _state = white.join_game(game_id).await;

    // Play a move so the game is in progress (resign requires moves on the board
    // because the engine's stage() checks moves.is_empty() before result).
    black.play(game_id, 0, 0).await;
    let _ = black.recv_kind("state").await;
    let _ = white.recv_kind("state").await;

    black.resign(game_id).await;

    let state_b = black.recv_kind("state").await;
    assert_eq!(state_b["stage"], "done");
    assert_eq!(state_b["result"], "White+R");

    let state_w = white.recv_kind("state").await;
    assert_eq!(state_w["stage"], "done");
    assert_eq!(state_w["result"], "White+R");
}

/// 5.2 -- White resigns: both receive stage "done", result "Black+R".
#[tokio::test]
async fn white_resigns() {
    let server = TestServer::start().await;
    let game_id = server.create_and_join().await;

    let mut black = server.ws_black().await;
    let mut white = server.ws_white().await;

    let _state = black.join_game(game_id).await;
    let _state = white.join_game(game_id).await;

    // Play a move so the game is in progress.
    black.play(game_id, 0, 0).await;
    let _ = black.recv_kind("state").await;
    let _ = white.recv_kind("state").await;

    white.resign(game_id).await;

    let state_b = black.recv_kind("state").await;
    assert_eq!(state_b["stage"], "done");
    assert_eq!(state_b["result"], "Black+R");

    let state_w = white.recv_kind("state").await;
    assert_eq!(state_w["stage"], "done");
    assert_eq!(state_w["result"], "Black+R");
}

/// 5.3 -- Resign on opponent's turn: White resigns while it's Black's turn.
#[tokio::test]
async fn resign_on_opponents_turn() {
    let server = TestServer::start().await;
    let game_id = server.create_and_join().await;

    let mut black = server.ws_black().await;
    let mut white = server.ws_white().await;

    let state = black.join_game(game_id).await;
    assert_eq!(state["stage"], "black_to_play");
    let _state = white.join_game(game_id).await;

    // Play a move so the game is in progress.
    black.play(game_id, 0, 0).await;
    let _ = black.recv_kind("state").await;
    let _ = white.recv_kind("state").await;

    // Now it's white's turn, play back to make it black's turn again.
    white.play(game_id, 1, 0).await;
    let _ = black.recv_kind("state").await;
    let _ = white.recv_kind("state").await;

    // It's black's turn, but white resigns anyway -- should succeed.
    white.resign(game_id).await;

    let state_b = black.recv_kind("state").await;
    assert_eq!(state_b["stage"], "done");
    assert_eq!(state_b["result"], "Black+R");

    let state_w = white.recv_kind("state").await;
    assert_eq!(state_w["stage"], "done");
    assert_eq!(state_w["result"], "Black+R");
}

/// 5.4 -- Resign an already-ended game: second resign gets an error.
#[tokio::test]
async fn resign_already_ended_game() {
    let server = TestServer::start().await;
    let game_id = server.create_and_join().await;

    let mut black = server.ws_black().await;
    let mut white = server.ws_white().await;

    let _state = black.join_game(game_id).await;
    let _state = white.join_game(game_id).await;

    // Play a move so the game is in progress.
    black.play(game_id, 0, 0).await;
    let _ = black.recv_kind("state").await;
    let _ = white.recv_kind("state").await;

    // Black resigns -- game ends.
    black.resign(game_id).await;

    let state_b = black.recv_kind("state").await;
    assert_eq!(state_b["stage"], "done");

    let state_w = white.recv_kind("state").await;
    assert_eq!(state_w["stage"], "done");

    // White tries to resign the already-ended game.
    white.resign(game_id).await;

    let err = white.recv_kind("error").await;
    assert!(err["message"].as_str().is_some());
}
