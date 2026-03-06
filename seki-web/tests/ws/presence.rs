use std::time::Duration;

use serde_json::json;

use crate::common::TestServer;

#[tokio::test]
async fn subscribe_presence_returns_current_state() {
    let server = TestServer::start().await;

    let mut black = server.ws_black().await;
    let _init = black.recv_kind("init").await;

    // Subscribe to white's presence (white is offline)
    black
        .send(json!({"action": "subscribe_presence", "user_ids": [server.white_id]}))
        .await;
    let state = black.recv_kind("presence_state").await;
    assert_eq!(state["users"][server.white_id.to_string()], false);

    // White connects
    let _white = server.ws_white().await;

    // Black should get presence_changed(online)
    let changed = black.recv_kind("presence_changed").await;
    assert_eq!(changed["user_id"], server.white_id);
    assert_eq!(changed["online"], true);
}

#[tokio::test]
async fn disconnect_notifies_subscribers() {
    let server = TestServer::start().await;

    let mut black = server.ws_black().await;
    let _init_b = black.recv_kind("init").await;

    let white = server.ws_white().await;

    // Subscribe to white's presence (white is online)
    black
        .send(json!({"action": "subscribe_presence", "user_ids": [server.white_id]}))
        .await;
    let state = black.recv_kind("presence_state").await;
    assert_eq!(state["users"][server.white_id.to_string()], true);

    // Drop white
    drop(white);

    // Black should get presence_changed(offline)
    let changed = black.recv_kind("presence_changed").await;
    assert_eq!(changed["user_id"], server.white_id);
    assert_eq!(changed["online"], false);
}

#[tokio::test]
async fn join_game_auto_subscribes_to_players() {
    let server = TestServer::start().await;
    let game_id = server.create_and_join().await;

    // Black connects and joins the game room — auto-subscribes to both players
    let mut black = server.ws_black().await;
    let _init = black.recv_kind("init").await;
    let _state = black.join_game(game_id).await;

    // Should receive presence_state from auto-subscribe
    let ps = black.recv_kind("presence_state").await;
    assert!(ps["users"].is_object());
    // Black is online (we're connected), white is offline (not connected via WS)
    assert_eq!(ps["users"][server.black_id.to_string()], true);
    assert_eq!(ps["users"][server.white_id.to_string()], false);

    // White connects
    let mut _white = server.ws_white().await;

    // Black should get presence_changed for white coming online
    let changed = black.recv_kind("presence_changed").await;
    assert_eq!(changed["user_id"], server.white_id);
    assert_eq!(changed["online"], true);
}

#[tokio::test]
async fn multiple_connections_no_false_offline() {
    let server = TestServer::start().await;

    let mut observer = server.ws_black().await;
    let _init = observer.recv_kind("init").await;

    // Subscribe to white
    observer
        .send(json!({"action": "subscribe_presence", "user_ids": [server.white_id]}))
        .await;
    let _ = observer.recv_kind("presence_state").await;

    // White connects — observer gets presence_changed(online)
    let white1 = server.ws_white().await;
    let changed = observer.recv_kind("presence_changed").await;
    assert_eq!(changed["user_id"], server.white_id);
    assert_eq!(changed["online"], true);

    // White connects second tab — observer gets another presence_changed(online)
    let white2 = server.ws_white().await;
    let changed2 = observer.recv_kind("presence_changed").await;
    assert_eq!(changed2["user_id"], server.white_id);
    assert_eq!(changed2["online"], true);

    // Drop first connection — no offline expected because second is still alive
    drop(white1);
    let no_msg = tokio::time::timeout(
        Duration::from_millis(200),
        observer.recv_timeout(Duration::from_secs(1)),
    )
    .await;
    assert!(
        no_msg.is_err(),
        "should not get offline while second tab exists"
    );

    // Drop second (last) connection — offline expected
    drop(white2);
    let changed = observer.recv_kind("presence_changed").await;
    assert_eq!(changed["user_id"], server.white_id);
    assert_eq!(changed["online"], false);
}
