use crate::common::{TestServer, api_error_message};

// -- Resign Guards --

#[tokio::test]
async fn cannot_resign_before_first_move() {
    let server = TestServer::start().await;

    let game_id = server.create_and_join().await;

    let mut ws_black = server.ws_black().await;
    ws_black.join_game(game_id).await;

    // Try to resign before any moves
    ws_black.resign(game_id).await;

    let msg = ws_black.recv_kind("error").await;
    assert!(
        msg["message"].as_str().unwrap_or("").contains("first move"),
        "Expected error about first move, got: {:?}",
        msg
    );
}

#[tokio::test]
async fn can_resign_after_first_move() {
    let server = TestServer::start().await;

    let game_id = server.create_and_join().await;

    let mut ws_black = server.ws_black().await;
    let mut ws_white = server.ws_white().await;
    ws_black.join_game(game_id).await;
    ws_white.join_game(game_id).await;

    // Black plays a move
    ws_black.play(game_id, 0, 0).await;
    ws_black.recv_kind("state").await;
    ws_white.recv_kind("state").await;

    // Now black can resign
    ws_black.resign(game_id).await;

    let msg = ws_black.recv_kind("state").await;
    assert!(
        msg["result"].as_str().is_some(),
        "Game should be finished after resign"
    );
    assert!(msg["result"].as_str().unwrap().contains("W+"));
}

// -- Territory Review Guards --

#[tokio::test]
async fn cannot_play_move_during_territory_review() {
    let server = TestServer::start().await;

    let game_id = server.create_and_join().await;

    let mut ws_black = server.ws_black().await;
    let mut ws_white = server.ws_white().await;
    ws_black.join_game(game_id).await;
    ws_white.join_game(game_id).await;

    // Both players pass to enter territory review
    ws_black.pass(game_id).await;
    ws_black.recv_kind("state").await;
    ws_white.recv_kind("state").await;

    ws_white.pass(game_id).await;
    // Consume chat message about territory review and state updates
    ws_white.recv_kind("state").await;
    ws_black.recv_kind("state").await;

    // Now in territory review, try to play
    ws_black.play(game_id, 0, 0).await;

    let msg = ws_black.recv_kind("error").await;
    assert!(
        msg["message"]
            .as_str()
            .unwrap_or("")
            .contains("territory review"),
        "Expected error about territory review, got: {:?}",
        msg
    );
}

#[tokio::test]
async fn cannot_pass_during_territory_review() {
    let server = TestServer::start().await;

    let game_id = server.create_and_join().await;

    let mut ws_black = server.ws_black().await;
    let mut ws_white = server.ws_white().await;
    ws_black.join_game(game_id).await;
    ws_white.join_game(game_id).await;

    // Both players pass to enter territory review
    ws_black.pass(game_id).await;
    ws_black.recv_kind("state").await;
    ws_white.recv_kind("state").await;

    ws_white.pass(game_id).await;
    // Consume state updates
    ws_white.recv_kind("state").await;
    ws_black.recv_kind("state").await;

    // Now in territory review, try to pass
    ws_black.pass(game_id).await;

    let msg = ws_black.recv_kind("error").await;
    assert!(
        msg["message"]
            .as_str()
            .unwrap_or("")
            .contains("territory review"),
        "Expected error about territory review, got: {:?}",
        msg
    );
}

// -- Territory Approval Guards --

#[tokio::test]
async fn cannot_approve_territory_twice() {
    let server = TestServer::start().await;

    let game_id = server.create_and_join().await;

    let mut ws_black = server.ws_black().await;
    let mut ws_white = server.ws_white().await;
    ws_black.join_game(game_id).await;
    ws_white.join_game(game_id).await;

    // Both players pass to enter territory review
    ws_black.pass(game_id).await;
    ws_black.recv_kind("state").await;
    ws_white.recv_kind("state").await;

    ws_white.pass(game_id).await;
    // Consume state updates (there may be a chat message too)
    ws_white.recv_kind("state").await;
    ws_black.recv_kind("state").await;

    // Black approves territory
    ws_black.approve_territory(game_id).await;
    ws_black.recv_kind("state").await;
    ws_white.recv_kind("state").await;

    // Black tries to approve again
    ws_black.approve_territory(game_id).await;

    let msg = ws_black.recv_kind("error").await;
    assert!(
        msg["message"]
            .as_str()
            .unwrap_or("")
            .contains("already approved"),
        "Expected error about already approved, got: {:?}",
        msg
    );
}

// -- Join Guards (covered in security.rs but adding here for completeness) --

#[tokio::test]
async fn cannot_join_game_that_is_full() {
    let server = TestServer::start().await;

    let game_id = server.create_and_join().await;

    // Spectator tries to join a full game
    let resp = server.join_game_as_spectator(game_id).await;
    assert_eq!(resp.status(), 422);
    assert!(api_error_message(resp).await.contains("full"));
}
