use crate::common::TestServer;

/// 15.1 — Game created event: observer receives `game_created` when a game is created.
#[tokio::test]
async fn game_created_event() {
    let server = TestServer::start().await;

    // Observer connects via WS (no game room join)
    let mut observer = server.ws_black().await;
    let _init = observer.recv_kind("init").await;

    // Create a game via API
    let game_id = server.create_game().await;

    // Observer receives game_created lobby broadcast
    let msg = observer.recv_kind("game_created").await;
    assert_eq!(msg["kind"], "game_created");
    assert_eq!(msg["game"]["id"], game_id);
    assert_eq!(msg["game"]["stage"], "unstarted");
    assert!(msg["game"]["settings"]["cols"].as_i64().is_some());
}

/// 15.2 — Game updated event: observer receives `game_updated` after a move is played.
#[tokio::test]
async fn game_updated_event() {
    let server = TestServer::start().await;

    // Observer connects via WS (no game room join)
    let mut observer = server.ws_white().await;
    let _init = observer.recv_kind("init").await;

    // Create game (triggers game_created)
    let game_id = server.create_game().await;
    let _created1 = observer.recv_kind("game_created").await;

    // White joins the game (triggers another game_created)
    server.join_game(game_id).await;
    let _created2 = observer.recv_kind("game_created").await;

    // Black connects WS, joins game room, and plays a move
    let mut black = server.ws_black().await;
    let _init_b = black.recv_kind("init").await;
    let _state = black.join_game(game_id).await;
    black.play(game_id, 3, 3).await;
    let _state_b = black.recv_kind("state").await;

    // Observer receives game_updated after the move
    let msg = observer.recv_kind("game_updated").await;
    assert_eq!(msg["kind"], "game_updated");
    assert_eq!(msg["game"]["id"], game_id);
    // NOTE: game_updated uses gwp.game.stage which may be stale (loaded before
    // the move). The move_count is the reliable indicator of progress.
    assert_eq!(msg["game"]["move_count"], 1);
}

/// 15.3 — Game removed event: observer receives `game_removed` when a game is deleted.
#[tokio::test]
async fn game_removed_event_on_delete() {
    let server = TestServer::start().await;

    // Observer connects via WS (no game room join)
    let mut observer = server.ws_black().await;
    let _init = observer.recv_kind("init").await;

    // Create game (not joined — still unstarted, eligible for deletion)
    let game_id = server.create_game().await;
    let _created = observer.recv_kind("game_created").await;

    // Delete the game via API (only creator can delete, game must not have started)
    let resp = server
        .client_black
        .delete(format!("http://{}/api/games/{game_id}", server.addr))
        .header("Authorization", "Bearer test-black-api-token-12345")
        .send()
        .await
        .unwrap();
    assert!(resp.status().is_success(), "delete failed: {}", resp.status());

    // Observer receives game_removed
    let msg = observer.recv_kind("game_removed").await;
    assert_eq!(msg["kind"], "game_removed");
    assert_eq!(msg["game_id"], game_id);
}

/// 15.3b — Game removed event: observer receives `game_removed` when a game is aborted.
#[tokio::test]
async fn game_removed_event_on_abort() {
    let server = TestServer::start().await;

    // Observer connects via WS (no game room join)
    let mut observer = server.ws_white().await;
    let _init = observer.recv_kind("init").await;

    // Create and join game (triggers two game_created events)
    let game_id = server.create_and_join().await;
    let _created1 = observer.recv_kind("game_created").await;
    let _created2 = observer.recv_kind("game_created").await;

    // Black aborts via API (game has not started — no moves played)
    let resp = server
        .client_black
        .post(format!("http://{}/api/games/{game_id}/abort", server.addr))
        .header("Authorization", "Bearer test-black-api-token-12345")
        .send()
        .await
        .unwrap();
    assert!(resp.status().is_success(), "abort failed: {}", resp.status());

    // Observer receives game_removed
    let msg = observer.recv_kind("game_removed").await;
    assert_eq!(msg["kind"], "game_removed");
    assert_eq!(msg["game_id"], game_id);
}
