use crate::common::TestServer;

/// Build the ko shape on a 9×9 board.
///
/// Target position (top-left corner, rest empty):
/// ```
///      c0  c1  c2  c3
/// r0:   .   B   W   .
/// r1:   B   W   .   W
/// r2:   .   B   W   .
/// ```
///
/// Move sequence (B first, alternating):
///  1. B(1,0)  2. W(2,0)  3. B(0,1)  4. W(1,1)
///  5. B(1,2)  6. W(3,1)  7. B(8,8)  8. W(2,2)
///
/// Then B(2,1) captures W(1,1), creating a ko at (1,1) illegal for White.
async fn setup_ko(
    black: &mut crate::common::WsClient,
    white: &mut crate::common::WsClient,
    game_id: i64,
) {
    let setup_moves: &[(bool, i32, i32)] = &[
        (true, 1, 0),  // B(1,0)
        (false, 2, 0), // W(2,0)
        (true, 0, 1),  // B(0,1)
        (false, 1, 1), // W(1,1)
        (true, 1, 2),  // B(1,2)
        (false, 3, 1), // W(3,1)
        (true, 8, 8),  // B(8,8) — throwaway
        (false, 2, 2), // W(2,2)
    ];

    for &(is_black, col, row) in setup_moves {
        if is_black {
            black.play(game_id, col, row).await;
        } else {
            white.play(game_id, col, row).await;
        }
        // Both players must consume the state broadcast.
        black.recv_kind("state").await;
        white.recv_kind("state").await;
    }
}

#[tokio::test]
async fn ko_immediate_recapture_blocked() {
    let server = TestServer::start().await;
    let game_id = server.create_and_join().await;

    let mut black = server.ws_black().await;
    let mut white = server.ws_white().await;
    let _init_b = black.recv_kind("init").await;
    let _init_w = white.recv_kind("init").await;
    let _state_b = black.join_game(game_id).await;
    let _state_w = white.join_game(game_id).await;

    setup_ko(&mut black, &mut white, game_id).await;

    // Black captures at (2,1), creating the ko.
    black.play(game_id, 2, 1).await;
    let state = black.recv_kind("state").await;
    let _state_w = white.recv_kind("state").await;

    // Ko should be active: pos = [1,1], illegal = -1 (White).
    let ko = &state["state"]["ko"];
    assert!(!ko.is_null(), "ko should be set after capturing move");
    assert_eq!(ko["pos"], serde_json::json!([1, 1]));
    assert_eq!(ko["illegal"], -1, "White should be the illegal player");

    // White tries to immediately recapture at the ko point (1,1) — must be rejected.
    white.play(game_id, 1, 1).await;
    let err = white.recv_kind("error").await;
    assert!(
        err["message"].as_str().is_some(),
        "expected an error message for ko violation"
    );
}

#[tokio::test]
async fn ko_resolved_after_intervening_moves() {
    let server = TestServer::start().await;
    let game_id = server.create_and_join().await;

    let mut black = server.ws_black().await;
    let mut white = server.ws_white().await;
    let _init_b = black.recv_kind("init").await;
    let _init_w = white.recv_kind("init").await;
    let _state_b = black.join_game(game_id).await;
    let _state_w = white.join_game(game_id).await;

    setup_ko(&mut black, &mut white, game_id).await;

    // Black captures at (2,1), creating the ko.
    black.play(game_id, 2, 1).await;
    black.recv_kind("state").await;
    white.recv_kind("state").await;

    // Ko threat: White plays elsewhere.
    white.play(game_id, 7, 7).await;
    black.recv_kind("state").await;
    white.recv_kind("state").await;

    // Ko response: Black plays elsewhere.
    black.play(game_id, 6, 6).await;
    black.recv_kind("state").await;
    white.recv_kind("state").await;

    // Now White can recapture at the ko point (1,1).
    white.play(game_id, 1, 1).await;
    let state = black.recv_kind("state").await;
    let _state_w = white.recv_kind("state").await;

    // The recapture should succeed — check that (1,1) now has a White stone.
    // board is a flat array indexed by row * cols + col; cols = 9.
    let board = &state["state"]["board"];
    let idx = 1 * 9 + 1; // row=1, col=1
    assert_eq!(board[idx], -1, "White stone should be at (1,1) after recapture");
}

#[tokio::test]
async fn ko_data_in_state() {
    let server = TestServer::start().await;
    let game_id = server.create_and_join().await;

    let mut black = server.ws_black().await;
    let mut white = server.ws_white().await;
    let _init_b = black.recv_kind("init").await;
    let _init_w = white.recv_kind("init").await;
    let _state_b = black.join_game(game_id).await;
    let _state_w = white.join_game(game_id).await;

    setup_ko(&mut black, &mut white, game_id).await;

    // Before the ko-triggering capture, ko should be null.
    // The last state from setup is from white's move at (2,2).
    // Let's check by making a non-ko move first.
    black.play(game_id, 7, 0).await;
    let state = black.recv_kind("state").await;
    white.recv_kind("state").await;
    assert!(
        state["state"]["ko"].is_null(),
        "ko should be null before any capturing move"
    );

    // White plays a throwaway so it's Black's turn again.
    white.play(game_id, 0, 8).await;
    black.recv_kind("state").await;
    white.recv_kind("state").await;

    // Black captures at (2,1), creating the ko.
    black.play(game_id, 2, 1).await;
    let state = black.recv_kind("state").await;
    white.recv_kind("state").await;

    // Ko should have pos and illegal fields.
    let ko = &state["state"]["ko"];
    assert!(!ko.is_null(), "ko should be set after capturing move");
    assert_eq!(ko["pos"], serde_json::json!([1, 1]));
    assert_eq!(ko["illegal"], -1);

    // After an intervening move, ko should be cleared.
    white.play(game_id, 7, 7).await;
    let state = black.recv_kind("state").await;
    white.recv_kind("state").await;

    assert!(
        state["state"]["ko"].is_null(),
        "ko should be null after intervening move"
    );
}
