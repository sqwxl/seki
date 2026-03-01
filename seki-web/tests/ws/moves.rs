use crate::common::TestServer;

/// 2.1 — Legal move: Black plays (3,3), board has stone, stage flips.
#[tokio::test]
async fn legal_move() {
    let server = TestServer::start().await;
    let game_id = server.create_and_join().await;

    let mut black = server.ws_black().await;
    let mut white = server.ws_white().await;

    let _state = black.join_game(game_id).await;
    let _state = white.join_game(game_id).await;

    black.play(game_id, 3, 3).await;

    let state_b = black.recv_kind("state").await;
    let state_w = white.recv_kind("state").await;

    // Board index for (col=3, row=3) on a 9-wide board: row * 9 + col = 3*9 + 3 = 30
    let board = state_b["state"]["board"].as_array().unwrap();
    assert_eq!(board[30], 1, "expected black stone at (3,3)");
    assert_eq!(state_b["stage"], "white_to_play");

    // White gets the same broadcast
    let board_w = state_w["state"]["board"].as_array().unwrap();
    assert_eq!(board_w[30], 1);
    assert_eq!(state_w["stage"], "white_to_play");
}

/// 2.2 — Capture: surround a white stone at (0,0) and capture it.
///
/// Sequence: B(1,0), W(0,0), B(0,1) — captures W at (0,0).
#[tokio::test]
async fn capture() {
    let server = TestServer::start().await;
    let game_id = server.create_and_join().await;

    let mut black = server.ws_black().await;
    let mut white = server.ws_white().await;

    let _state = black.join_game(game_id).await;
    let _state = white.join_game(game_id).await;

    // Move 1: B(1,0)
    black.play(game_id, 1, 0).await;
    let _ = black.recv_kind("state").await;
    let _ = white.recv_kind("state").await;

    // Move 2: W(0,0)
    white.play(game_id, 0, 0).await;
    let _ = black.recv_kind("state").await;
    let _ = white.recv_kind("state").await;

    // Move 3: B(0,1) — captures W(0,0)
    black.play(game_id, 0, 1).await;
    let state_b = black.recv_kind("state").await;
    let state_w = white.recv_kind("state").await;

    // (0,0) is index 0*9+0 = 0: should be empty (captured)
    let board = state_b["state"]["board"].as_array().unwrap();
    assert_eq!(board[0], 0, "white stone at (0,0) should be captured");

    // Black's captures should be 1
    assert_eq!(
        state_b["state"]["captures"]["black"], 1,
        "black should have 1 capture"
    );

    // White sees the same state
    let board_w = state_w["state"]["board"].as_array().unwrap();
    assert_eq!(board_w[0], 0);
    assert_eq!(state_w["state"]["captures"]["black"], 1);
}

/// 2.3 — Out of turn: Black plays, then Black tries to play again.
#[tokio::test]
async fn out_of_turn() {
    let server = TestServer::start().await;
    let game_id = server.create_and_join().await;

    let mut black = server.ws_black().await;
    let mut white = server.ws_white().await;

    let _state = black.join_game(game_id).await;
    let _state = white.join_game(game_id).await;

    // Black's first move (legal)
    black.play(game_id, 3, 3).await;
    let _ = black.recv_kind("state").await;
    let _ = white.recv_kind("state").await;

    // Black tries again — it's White's turn
    black.play(game_id, 4, 4).await;
    let err = black.recv_kind("error").await;
    assert!(
        !err["message"].as_str().unwrap().is_empty(),
        "expected an error message for out-of-turn play"
    );

    // White should NOT receive anything for this error.
    // We verify by sending a valid white move and checking that white's
    // next message is the state from that move, not an error echo.
    white.play(game_id, 5, 5).await;
    let state_w = white.recv_kind("state").await;
    assert_eq!(state_w["stage"], "black_to_play");
    let _ = black.recv_kind("state").await;
}

/// 2.4 — Occupied intersection: Black plays (3,3), White tries (3,3).
#[tokio::test]
async fn occupied_intersection() {
    let server = TestServer::start().await;
    let game_id = server.create_and_join().await;

    let mut black = server.ws_black().await;
    let mut white = server.ws_white().await;

    let _state = black.join_game(game_id).await;
    let _state = white.join_game(game_id).await;

    // Black plays (3,3)
    black.play(game_id, 3, 3).await;
    let _ = black.recv_kind("state").await;
    let _ = white.recv_kind("state").await;

    // White tries to play on the same spot
    white.play(game_id, 3, 3).await;
    let err = white.recv_kind("error").await;
    assert!(
        !err["message"].as_str().unwrap().is_empty(),
        "expected an error for playing on an occupied intersection"
    );
}

/// 2.5 — Suicide: playing into a position with zero liberties and no captures.
///
/// Setup: B(1,0), W(5,5), B(0,1). Now (0,0) has both neighbors occupied by Black.
/// White tries (0,0) — zero liberties, no capture → suicide → error.
#[tokio::test]
async fn suicide() {
    let server = TestServer::start().await;
    let game_id = server.create_and_join().await;

    let mut black = server.ws_black().await;
    let mut white = server.ws_white().await;

    let _state = black.join_game(game_id).await;
    let _state = white.join_game(game_id).await;

    // Move 1: B(1,0)
    black.play(game_id, 1, 0).await;
    let _ = black.recv_kind("state").await;
    let _ = white.recv_kind("state").await;

    // Move 2: W(5,5) — a neutral move far away
    white.play(game_id, 5, 5).await;
    let _ = black.recv_kind("state").await;
    let _ = white.recv_kind("state").await;

    // Move 3: B(0,1)
    black.play(game_id, 0, 1).await;
    let _ = black.recv_kind("state").await;
    let _ = white.recv_kind("state").await;

    // Now White tries (0,0) — suicide: both liberties are Black stones
    white.play(game_id, 0, 0).await;
    let err = white.recv_kind("error").await;
    assert!(
        !err["message"].as_str().unwrap().is_empty(),
        "expected an error for suicide move"
    );
}
