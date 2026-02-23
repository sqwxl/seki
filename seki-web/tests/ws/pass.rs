use crate::common::TestServer;

/// 4.1 — Single pass: Black passes, both receive state with stage "white_to_play".
#[tokio::test]
async fn single_pass() {
    let server = TestServer::start().await;
    let game_id = server.create_and_join().await;

    let mut black = server.ws_black().await;
    let mut white = server.ws_white().await;

    let _state = black.join_game(game_id).await;
    let _state = white.join_game(game_id).await;

    black.pass(game_id).await;

    let state_b = black.recv_kind("state").await;
    let state_w = white.recv_kind("state").await;

    assert_eq!(state_b["stage"], "white_to_play");
    assert_eq!(state_w["stage"], "white_to_play");
}

/// 4.2 — Consecutive passes enter territory review.
///
/// Black passes, White passes. Both receive state with stage "territory_review"
/// and a non-null "territory" field. A system chat with "Territory review" text
/// is also broadcast. The chat and state may arrive in either order.
#[tokio::test]
async fn consecutive_passes_enter_territory_review() {
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

    // White passes — should trigger territory review
    white.pass(game_id).await;

    // After white's pass, each player receives a system chat message first
    // ("Territory review has begun"), then the state broadcast. Use recv_kind
    // to skip interleaved lobby broadcasts (game_updated). Order matters:
    // the server sends chat before state, and recv_kind discards non-matching messages.
    let b_chat = black.recv_kind("chat").await;
    let b_state = black.recv_kind("state").await;
    let w_chat = white.recv_kind("chat").await;
    let w_state = white.recv_kind("state").await;

    // Verify state messages
    assert_eq!(b_state["stage"], "territory_review");
    assert_eq!(w_state["stage"], "territory_review");

    assert!(
        b_state.get("territory").is_some() && !b_state["territory"].is_null(),
        "expected non-null territory field in black's state"
    );
    assert!(
        w_state.get("territory").is_some() && !w_state["territory"].is_null(),
        "expected non-null territory field in white's state"
    );

    // Verify chat messages
    let b_text = b_chat["text"].as_str().expect("chat should have text");
    assert!(
        b_text.contains("Territory review"),
        "expected territory review chat, got: {b_text}"
    );
    assert!(
        b_chat["player_id"].is_null(),
        "system chat should have null player_id"
    );

    let w_text = w_chat["text"].as_str().expect("chat should have text");
    assert!(
        w_text.contains("Territory review"),
        "expected territory review chat, got: {w_text}"
    );
}

/// 4.3 — Non-consecutive passes do not enter territory review.
///
/// B passes, W plays a move, B passes again. After B's second pass,
/// stage should be "white_to_play" (no territory review).
#[tokio::test]
async fn non_consecutive_passes_no_territory_review() {
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

    // White plays a move (breaks the consecutive pass sequence)
    white.play(game_id, 4, 4).await;
    let _ = black.recv_kind("state").await;
    let _ = white.recv_kind("state").await;

    // Black passes again
    black.pass(game_id).await;
    let state_b = black.recv_kind("state").await;
    let state_w = white.recv_kind("state").await;

    assert_eq!(
        state_b["stage"], "white_to_play",
        "non-consecutive passes should not trigger territory review"
    );
    assert_eq!(state_w["stage"], "white_to_play");
}

/// 4.4 — Pass out of turn: White tries to pass when it's black's turn.
#[tokio::test]
async fn pass_out_of_turn() {
    let server = TestServer::start().await;
    let game_id = server.create_and_join().await;

    let mut black = server.ws_black().await;
    let mut white = server.ws_white().await;

    let state = black.join_game(game_id).await;
    assert_eq!(state["stage"], "black_to_play");
    let _state = white.join_game(game_id).await;

    // White tries to pass on black's turn
    white.pass(game_id).await;

    let err = white.recv_kind("error").await;
    assert!(
        err["message"].as_str().unwrap().len() > 0,
        "expected an error message for pass out of turn"
    );
}

