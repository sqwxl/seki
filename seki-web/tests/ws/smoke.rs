use crate::common::TestServer;

#[tokio::test]
async fn smoke_ws_connect_and_join() {
    let server = TestServer::start().await;
    let game_id = server.create_and_join().await;

    let mut black = server.ws_black().await;

    // First message on connect is init
    let init = black.recv_kind("init").await;
    assert_eq!(init["kind"], "init");

    // Join the game room and receive full game state
    let state = black.join_game(game_id).await;
    assert_eq!(state["kind"], "state");
    assert_eq!(state["stage"], "black_to_play");
}
