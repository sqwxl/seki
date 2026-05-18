use serde_json::json;

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
async fn unrated_open_game_waits_for_pregame_settings_after_join() {
    let server = TestServer::start().await;

    let game_id = server
        .create_game_with(serde_json::json!({"cols": 13}))
        .await;
    let resp = server
        .client_white
        .post(format!("http://{}/api/games/{game_id}/join", server.addr))
        .header("Authorization", "Bearer test-white-api-token-67890")
        .json(&serde_json::json!({}))
        .send()
        .await
        .unwrap();
    assert!(resp.status().is_success());

    let mut spectator = server.ws_spectator().await;
    let _init = spectator.recv_kind("init").await;
    let state = spectator.join_game(game_id).await;

    assert_eq!(state["stage"], "unstarted");
    assert!(state["negotiations"]["pregame_settings"].is_object());
}

#[tokio::test]
async fn creator_can_reject_pregame_settings_and_return_to_waiting() {
    let server = TestServer::start().await;

    let game_id = server.create_game_with(json!({"cols": 13})).await;
    let resp = server
        .client_white
        .post(format!("http://{}/api/games/{game_id}/join", server.addr))
        .header("Authorization", "Bearer test-white-api-token-67890")
        .json(&json!({}))
        .send()
        .await
        .unwrap();
    assert!(resp.status().is_success());

    let mut black = server.ws_black().await;
    let mut white = server.ws_white().await;
    let _init_b = black.recv_kind("init").await;
    let _init_w = white.recv_kind("init").await;

    let state_b = black.join_game(game_id).await;
    assert!(state_b["negotiations"]["pregame_settings"].is_object());

    let state_w = white.join_game(game_id).await;
    assert!(state_w["negotiations"]["pregame_settings"].is_object());

    black
        .send(json!({"action": "reject_pregame_settings", "game_id": game_id}))
        .await;

    let state_b = black.recv_kind("state").await;
    let state_w = white.recv_kind("state").await;

    assert_eq!(state_b["stage"], "unstarted");
    assert!(state_b["negotiations"]["pregame_settings"].is_null());
    assert_eq!(state_b["black"]["id"], server.black_id);
    assert!(state_b["white"].is_null());

    assert_eq!(state_w["stage"], "unstarted");
    assert!(state_w["negotiations"]["pregame_settings"].is_null());
    assert_eq!(state_w["black"]["id"], server.black_id);
    assert!(state_w["white"].is_null());
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

    // Both players should receive state with stage "aborted" and result "Aborted".
    let state_b = black.recv_kind("state").await;
    assert_eq!(state_b["stage"], "aborted");
    assert_eq!(state_b["result"], "Aborted");

    let state_w = white.recv_kind("state").await;
    assert_eq!(state_w["stage"], "aborted");
    assert_eq!(state_w["result"], "Aborted");
}

#[tokio::test]
async fn white_can_abort_started_game_before_first_move() {
    let server = TestServer::start().await;
    let game_id = server.create_and_join().await;

    let mut white = server.ws_white().await;
    let _init = white.recv_kind("init").await;

    let state = white.join_game(game_id).await;
    assert_eq!(state["stage"], "black_to_play");

    white.abort(game_id).await;

    let state = white.recv_kind("state").await;
    assert_eq!(state["stage"], "aborted");
    assert_eq!(state["result"], "Aborted");
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
