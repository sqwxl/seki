use crate::common::TestServer;

#[tokio::test]
async fn create_and_join_stage_transitions() {
    let server = TestServer::start().await;

    // Create a game but don't have white join yet.
    let game_id = server.create_game().await;

    // Black connects WS and joins the game room.
    let mut black = server.ws_black().await;
    let _init = black.recv_kind("init").await;
    let state = black.join_game(game_id).await;

    // Game has only one player, so it should still be unstarted.
    assert_eq!(state["stage"], "unstarted");

    // White joins via the API — this doesn't broadcast state to WS game room.
    server.join_game(game_id).await;

    // White connects WS and joins the game room. Now that both players are
    // present, the game transitions to black_to_play.
    let mut white = server.ws_white().await;
    let _init_w = white.recv_kind("init").await;
    let state = white.join_game(game_id).await;
    assert_eq!(state["stage"], "black_to_play");
}

#[tokio::test]
async fn abort_before_first_move() {
    let server = TestServer::start().await;
    let game_id = server.create_and_join().await;

    // Both connect WS and join the game room.
    let mut black = server.ws_black().await;
    let mut white = server.ws_white().await;
    let _init_b = black.recv_kind("init").await;
    let _init_w = white.recv_kind("init").await;

    let state_b = black.join_game(game_id).await;
    assert_eq!(state_b["stage"], "black_to_play");

    let state_w = white.join_game(game_id).await;
    assert_eq!(state_w["stage"], "black_to_play");

    // Black aborts the game before any moves are played.
    black.abort(game_id).await;

    // Both players should receive state with stage "done" and result "Aborted".
    let state_b = black.recv_kind("state").await;
    assert_eq!(state_b["stage"], "done");
    assert_eq!(state_b["result"], "Aborted");

    let state_w = white.recv_kind("state").await;
    assert_eq!(state_w["stage"], "done");
    assert_eq!(state_w["result"], "Aborted");
}

#[tokio::test]
async fn abort_rejected_after_first_move() {
    let server = TestServer::start().await;
    let game_id = server.create_and_join().await;

    // Black connects WS and joins the game room.
    let mut black = server.ws_black().await;
    let _init = black.recv_kind("init").await;

    let state = black.join_game(game_id).await;
    assert_eq!(state["stage"], "black_to_play");

    // Black plays a move.
    black.play(game_id, 3, 3).await;
    let _state = black.recv_kind("state").await;

    // Black tries to abort after a move has been played.
    black.abort(game_id).await;

    // Should receive an error, not a state update.
    let err = black.recv_kind("error").await;
    assert!(err["message"].as_str().is_some());
}
