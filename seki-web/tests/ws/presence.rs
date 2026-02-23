use std::time::Duration;

use crate::common::TestServer;

#[tokio::test]
async fn join_broadcasts_presence() {
    let server = TestServer::start().await;
    let game_id = server.create_and_join().await;

    // Black connects and joins the game room.
    let mut black = server.ws_black().await;
    let _init_b = black.recv_kind("init").await;
    let _state_b = black.join_game(game_id).await;
    // Note: black's own presence(online=true) was broadcast on join, but
    // join_game() internally calls recv_kind("state") which skips past it.

    // White connects and joins.
    let mut white = server.ws_white().await;
    let _init_w = white.recv_kind("init").await;
    let _state_w = white.join_game(game_id).await;

    // Black should receive a presence message for white coming online.
    let presence = black.recv_kind("presence").await;
    assert_eq!(presence["player_id"], server.white_id);
    assert_eq!(presence["online"], true);
}

#[tokio::test]
async fn disconnect_broadcasts_offline() {
    let server = TestServer::start().await;
    let game_id = server.create_and_join().await;

    // Both players connect and join.
    let mut black = server.ws_black().await;
    let mut white = server.ws_white().await;
    let _init_b = black.recv_kind("init").await;
    let _init_w = white.recv_kind("init").await;
    let _state_b = black.join_game(game_id).await;
    let _state_w = white.join_game(game_id).await;

    // Drain the presence message black received when white joined.
    let _ = black.recv_kind("presence").await;

    // Drop white to disconnect.
    drop(white);

    // Black should receive an offline presence for white.
    let presence = black.recv_kind("presence").await;
    assert_eq!(presence["player_id"], server.white_id);
    assert_eq!(presence["online"], false);
}

#[tokio::test]
async fn multiple_connections_no_false_offline() {
    let server = TestServer::start().await;
    let game_id = server.create_and_join().await;

    // White connects first as the observer.
    let mut white = server.ws_white().await;
    let _init_w = white.recv_kind("init").await;
    let _state_w = white.join_game(game_id).await;

    // Black connects twice (simulating two browser tabs).
    let mut black1 = server.ws_black().await;
    let _init_b1 = black1.recv_kind("init").await;
    let _state_b1 = black1.join_game(game_id).await;

    // White receives presence(black, online=true) from black1 joining.
    let p = white.recv_kind("presence").await;
    assert_eq!(p["player_id"], server.black_id);
    assert_eq!(p["online"], true);

    let mut black2 = server.ws_black().await;
    let _init_b2 = black2.recv_kind("init").await;
    let _state_b2 = black2.join_game(game_id).await;

    // White receives another presence(black, online=true) from black2 joining.
    let p = white.recv_kind("presence").await;
    assert_eq!(p["player_id"], server.black_id);
    assert_eq!(p["online"], true);

    // Drop the first black connection.
    drop(black1);

    // White should NOT receive an offline presence because black2 is still connected.
    // Verify by waiting briefly and confirming no message arrives.
    let no_msg = tokio::time::timeout(
        Duration::from_millis(500),
        white.recv_timeout(Duration::from_secs(3)),
    )
    .await;
    assert!(
        no_msg.is_err(),
        "should not receive offline while second connection exists"
    );

    // Drop the second (last) black connection.
    drop(black2);

    // NOW white should receive presence(black, online=false).
    let p = white.recv_kind("presence").await;
    assert_eq!(p["player_id"], server.black_id);
    assert_eq!(p["online"], false);
}
