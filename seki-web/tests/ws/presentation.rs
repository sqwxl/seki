use std::sync::Arc;

use argon2::password_hash::SaltString;
use argon2::password_hash::rand_core::OsRng;
use argon2::{Argon2, PasswordHasher};
use reqwest::cookie::CookieStore;

use crate::common::{TestServer, WsClient};

/// Helper: create a third user (spectator), log them in, and return (id, WsClient).
async fn create_spectator(ts: &TestServer) -> (i64, WsClient) {
    let salt = SaltString::generate(&mut OsRng);
    let password_hash = Argon2::default()
        .hash_password(b"testpassword", &salt)
        .unwrap()
        .to_string();

    let spectator_id: i64 = sqlx::query_scalar(
        "INSERT INTO users (session_token, username, password_hash, api_token) \
         VALUES ($1, $2, $3, $4) RETURNING id",
    )
    .bind("spectator-session-token")
    .bind("test-spectator")
    .bind(&password_hash)
    .bind("test-spectator-api-token")
    .fetch_one(&ts.pool)
    .await
    .unwrap();

    let jar = Arc::new(reqwest::cookie::Jar::default());
    let client = reqwest::Client::builder()
        .cookie_provider(jar.clone())
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .unwrap();

    let base = format!("http://{}", ts.addr);
    client.get(format!("{base}/login")).send().await.unwrap();
    client
        .post(format!("{base}/login"))
        .form(&[("username", "test-spectator"), ("password", "testpassword")])
        .send()
        .await
        .unwrap();

    let url = format!("ws://{}/ws", ts.addr);
    let req_url = reqwest::Url::parse(&format!("http://{}", ts.addr)).unwrap();
    let cookie_header = jar
        .cookies(&req_url)
        .map(|c: axum::http::HeaderValue| c.to_str().unwrap().to_string())
        .unwrap_or_default();
    let request = tokio_tungstenite::tungstenite::http::Request::builder()
        .uri(&url)
        .header("Cookie", cookie_header)
        .header("Host", &ts.addr)
        .header("Connection", "Upgrade")
        .header("Upgrade", "websocket")
        .header("Sec-WebSocket-Version", "13")
        .header(
            "Sec-WebSocket-Key",
            tokio_tungstenite::tungstenite::handshake::client::generate_key(),
        )
        .body(())
        .unwrap();
    let (stream, _) = tokio_tungstenite::connect_async(request).await.unwrap();
    let (sink, stream_half) = futures_util::StreamExt::split(stream);
    let ws = WsClient::from_parts(sink, stream_half);

    (spectator_id, ws)
}

/// Helper: create a game, play two passes, approve territory on both sides,
/// then close both WS connections. Returns game_id with both clients disconnected.
async fn finish_game(ts: &TestServer) -> i64 {
    let game_id = ts.create_and_join().await;

    let mut black = ts.ws_black().await;
    let mut white = ts.ws_white().await;

    let _ = black.join_game(game_id).await;
    let _ = white.join_game(game_id).await;

    // Double pass -> territory review
    black.pass(game_id).await;
    let _ = black.recv_kind("state").await;
    let _ = white.recv_kind("state").await;

    white.pass(game_id).await;
    let _ = black.recv_kind("chat").await;
    let _ = black.recv_kind("state").await;
    let _ = white.recv_kind("chat").await;
    let _ = white.recv_kind("state").await;

    // Both approve -> game ends
    black.approve_territory(game_id).await;
    let _ = black.recv_kind("state").await;
    let _ = white.recv_kind("state").await;

    white.approve_territory(game_id).await;
    let _ = black.recv_kind("chat").await;
    let _ = black.recv_kind("state").await;
    let _ = white.recv_kind("chat").await;
    let _ = white.recv_kind("state").await;

    // Close connections
    black.close().await;
    white.close().await;

    // Brief pause for server cleanup
    tokio::time::sleep(std::time::Duration::from_millis(100)).await;

    game_id
}

#[tokio::test]
async fn start_and_end_presentation() {
    let ts = TestServer::start().await;
    let game_id = finish_game(&ts).await;

    let mut black = ts.ws_black().await;
    let mut white = ts.ws_white().await;

    let _ = black.join_game(game_id).await;
    let _ = white.join_game(game_id).await;

    // Black starts a presentation
    black.start_presentation(game_id).await;

    let msg_b = black.recv_kind("presentation_started").await;
    let msg_w = white.recv_kind("presentation_started").await;

    assert_eq!(msg_b["presenter_id"], ts.black_id);
    assert_eq!(msg_b["originator_id"], ts.black_id);
    assert_eq!(msg_w["presenter_id"], ts.black_id);

    // Presenter sends a snapshot — viewer receives it, presenter does not
    black
        .send_presentation_state(game_id, r#"{"tree":"test","activeNodeId":"root"}"#)
        .await;

    let update = white.recv_kind("presentation_update").await;
    assert_eq!(
        update["snapshot"],
        r#"{"tree":"test","activeNodeId":"root"}"#
    );

    // End presentation
    black.end_presentation(game_id).await;

    let end_b = black.recv_kind("presentation_ended").await;
    let end_w = white.recv_kind("presentation_ended").await;
    assert_eq!(end_b["game_id"], game_id);
    assert_eq!(end_w["game_id"], game_id);
}

#[tokio::test]
async fn late_joiner_gets_presentation_state() {
    let ts = TestServer::start().await;
    let game_id = finish_game(&ts).await;

    let mut black = ts.ws_black().await;
    let _ = black.join_game(game_id).await;

    // Start and send a snapshot
    black.start_presentation(game_id).await;
    let _ = black.recv_kind("presentation_started").await;

    black
        .send_presentation_state(game_id, r#"{"tree":"cached","activeNodeId":"n1"}"#)
        .await;

    // White joins late — should receive presentation_started with cached snapshot
    let mut white = ts.ws_white().await;
    let _ = white.join_game(game_id).await;

    let pres = white.recv_kind("presentation_started").await;
    assert_eq!(pres["presenter_id"], ts.black_id);
    assert_eq!(pres["snapshot"], r#"{"tree":"cached","activeNodeId":"n1"}"#);
}

#[tokio::test]
async fn cannot_start_second_presentation() {
    let ts = TestServer::start().await;
    let game_id = finish_game(&ts).await;

    let mut black = ts.ws_black().await;
    let mut white = ts.ws_white().await;

    let _ = black.join_game(game_id).await;
    let _ = white.join_game(game_id).await;

    black.start_presentation(game_id).await;
    let _ = black.recv_kind("presentation_started").await;
    let _ = white.recv_kind("presentation_started").await;

    // White tries to start another presentation
    white.start_presentation(game_id).await;

    let err = white.recv_kind("error").await;
    assert!(
        err["message"].as_str().unwrap().contains("already active"),
        "expected 'already active' error, got: {}",
        err["message"]
    );
}

#[tokio::test]
async fn control_transfer_give_and_take() {
    let ts = TestServer::start().await;
    let game_id = finish_game(&ts).await;

    let mut black = ts.ws_black().await;
    let mut white = ts.ws_white().await;

    let _ = black.join_game(game_id).await;
    let _ = white.join_game(game_id).await;

    // Black starts, gives control to white
    black.start_presentation(game_id).await;
    let _ = black.recv_kind("presentation_started").await;
    let _ = white.recv_kind("presentation_started").await;

    black.give_control(game_id, ts.white_id).await;

    let cc_b = black.recv_kind("control_changed").await;
    let cc_w = white.recv_kind("control_changed").await;
    assert_eq!(cc_b["presenter_id"], ts.white_id);
    assert_eq!(cc_w["presenter_id"], ts.white_id);

    // White can now send snapshots
    white
        .send_presentation_state(game_id, r#"{"tree":"from_white","activeNodeId":"w1"}"#)
        .await;

    let update = black.recv_kind("presentation_update").await;
    assert_eq!(
        update["snapshot"],
        r#"{"tree":"from_white","activeNodeId":"w1"}"#
    );

    // Originator (black) takes back control
    black.take_control(game_id).await;

    let cc_b = black.recv_kind("control_changed").await;
    let cc_w = white.recv_kind("control_changed").await;
    assert_eq!(cc_b["presenter_id"], ts.black_id);
    assert_eq!(cc_w["presenter_id"], ts.black_id);
}

#[tokio::test]
async fn request_control_flow() {
    let ts = TestServer::start().await;
    let game_id = finish_game(&ts).await;

    let mut black = ts.ws_black().await;
    let mut white = ts.ws_white().await;

    let _ = black.join_game(game_id).await;
    let _ = white.join_game(game_id).await;

    black.start_presentation(game_id).await;
    let _ = black.recv_kind("presentation_started").await;
    let _ = white.recv_kind("presentation_started").await;

    // White requests control
    white.request_control(game_id).await;

    let req_b = black.recv_kind("control_requested").await;
    let req_w = white.recv_kind("control_requested").await;
    assert_eq!(req_b["user_id"], ts.white_id);
    assert!(req_b["display_name"].as_str().is_some());
    assert_eq!(req_w["user_id"], ts.white_id);

    // Duplicate request should fail
    white.request_control(game_id).await;
    let err = white.recv_kind("error").await;
    assert!(
        err["message"].as_str().unwrap().contains("already pending"),
        "expected 'already pending' error, got: {}",
        err["message"]
    );

    // Cancel the request
    white.cancel_control_request(game_id).await;

    let cancel_b = black.recv_kind("control_request_cancelled").await;
    let cancel_w = white.recv_kind("control_request_cancelled").await;
    assert_eq!(cancel_b["game_id"], game_id);
    assert_eq!(cancel_w["game_id"], game_id);
}

#[tokio::test]
async fn presenter_disconnect_fallback() {
    let ts = TestServer::start().await;
    let game_id = finish_game(&ts).await;

    let mut black = ts.ws_black().await;
    let mut white = ts.ws_white().await;

    let _ = black.join_game(game_id).await;
    let _ = white.join_game(game_id).await;

    // Black (originator) starts, gives to white, then disconnects white
    black.start_presentation(game_id).await;
    let _ = black.recv_kind("presentation_started").await;
    let _ = white.recv_kind("presentation_started").await;

    black.give_control(game_id, ts.white_id).await;
    let _ = black.recv_kind("control_changed").await;
    let _ = white.recv_kind("control_changed").await;

    // White (non-originator presenter) disconnects -> falls back to originator (black)
    white.close().await;

    let cc = black.recv_kind("control_changed").await;
    assert_eq!(
        cc["presenter_id"], ts.black_id,
        "control should fall back to originator"
    );
}

#[tokio::test]
async fn presenter_disconnect_no_fallback() {
    let ts = TestServer::start().await;
    let game_id = finish_game(&ts).await;

    let mut black = ts.ws_black().await;

    let _ = black.join_game(game_id).await;

    // Black starts presentation alone (white not in room).
    // When black disconnects, there's no fallback -> presentation ends.
    black.start_presentation(game_id).await;
    let _ = black.recv_kind("presentation_started").await;

    black.close().await;

    // Brief pause for cleanup
    tokio::time::sleep(std::time::Duration::from_millis(200)).await;

    // Verify: a new client joining should NOT see a presentation
    let mut viewer = ts.ws_white().await;
    let state = viewer.join_game(game_id).await;
    assert_eq!(state["stage"], "completed");

    // Try to recv presentation_started — should time out (no active presentation)
    let result = tokio::time::timeout(
        std::time::Duration::from_millis(500),
        viewer.recv_kind("presentation_started"),
    )
    .await;
    assert!(
        result.is_err(),
        "should not receive presentation_started after presenter disconnected with no fallback"
    );
}

#[tokio::test]
async fn has_had_presentation_set_on_end() {
    let ts = TestServer::start().await;
    let game_id = finish_game(&ts).await;

    let (spectator_id, mut spectator) = create_spectator(&ts).await;

    // Spectator joins the game room
    let _ = spectator.join_game(game_id).await;

    // Spectator tries to start presentation — both players are in the room, no prior
    // presentation, game < 24h old → should fail
    let mut black = ts.ws_black().await;
    let _ = black.join_game(game_id).await;

    spectator.start_presentation(game_id).await;
    let err = spectator.recv_kind("error").await;
    assert!(
        err["message"].as_str().unwrap().contains("Not eligible"),
        "spectator should not be eligible before a presentation has ended: {}",
        err["message"]
    );

    // A player starts and ends a presentation
    black.start_presentation(game_id).await;
    let _ = black.recv_kind("presentation_started").await;
    let _ = spectator.recv_kind("presentation_started").await;

    black.end_presentation(game_id).await;
    let _ = black.recv_kind("presentation_ended").await;
    let _ = spectator.recv_kind("presentation_ended").await;

    // Now spectator should be eligible (has_had_presentation is true)
    spectator.start_presentation(game_id).await;
    let msg = spectator.recv_kind("presentation_started").await;
    assert_eq!(msg["presenter_id"], spectator_id);
}

#[tokio::test]
async fn reject_control_request_by_presenter() {
    let ts = TestServer::start().await;
    let game_id = finish_game(&ts).await;

    let mut black = ts.ws_black().await;
    let mut white = ts.ws_white().await;

    let _ = black.join_game(game_id).await;
    let _ = white.join_game(game_id).await;

    black.start_presentation(game_id).await;
    let _ = black.recv_kind("presentation_started").await;
    let _ = white.recv_kind("presentation_started").await;

    // White requests control
    white.request_control(game_id).await;
    let _ = black.recv_kind("control_requested").await;
    let _ = white.recv_kind("control_requested").await;

    // Black (presenter) rejects the request
    black.reject_control_request(game_id).await;

    let cancel_b = black.recv_kind("control_request_cancelled").await;
    let cancel_w = white.recv_kind("control_request_cancelled").await;
    assert_eq!(cancel_b["game_id"], game_id);
    assert_eq!(cancel_w["game_id"], game_id);

    // White can request again after rejection
    white.request_control(game_id).await;
    let req = black.recv_kind("control_requested").await;
    assert_eq!(req["user_id"], ts.white_id);
}

#[tokio::test]
async fn reject_control_request_by_originator_while_not_presenting() {
    let ts = TestServer::start().await;
    let game_id = finish_game(&ts).await;

    let (spectator_id, mut spectator) = create_spectator(&ts).await;

    let mut black = ts.ws_black().await;
    let mut white = ts.ws_white().await;

    let _ = black.join_game(game_id).await;
    let _ = white.join_game(game_id).await;
    let _ = spectator.join_game(game_id).await;

    // Black starts, gives control to spectator
    black.start_presentation(game_id).await;
    let _ = black.recv_kind("presentation_started").await;
    let _ = white.recv_kind("presentation_started").await;
    let _ = spectator.recv_kind("presentation_started").await;

    black.give_control(game_id, spectator_id).await;
    let _ = black.recv_kind("control_changed").await;
    let _ = white.recv_kind("control_changed").await;
    let _ = spectator.recv_kind("control_changed").await;

    // White requests control (broadcast to all)
    white.request_control(game_id).await;
    let _ = black.recv_kind("control_requested").await;
    let _ = white.recv_kind("control_requested").await;
    let _ = spectator.recv_kind("control_requested").await;

    // Black (originator, NOT presenter) rejects the request
    black.reject_control_request(game_id).await;

    let cancel_b = black.recv_kind("control_request_cancelled").await;
    let cancel_w = white.recv_kind("control_request_cancelled").await;
    let cancel_s = spectator.recv_kind("control_request_cancelled").await;
    assert_eq!(cancel_b["game_id"], game_id);
    assert_eq!(cancel_w["game_id"], game_id);
    assert_eq!(cancel_s["game_id"], game_id);
}

#[tokio::test]
async fn non_presenter_cannot_send_snapshot() {
    let ts = TestServer::start().await;
    let game_id = finish_game(&ts).await;

    let mut black = ts.ws_black().await;
    let mut white = ts.ws_white().await;

    let _ = black.join_game(game_id).await;
    let _ = white.join_game(game_id).await;

    black.start_presentation(game_id).await;
    let _ = black.recv_kind("presentation_started").await;
    let _ = white.recv_kind("presentation_started").await;

    // White (not the presenter) tries to send a snapshot
    white
        .send_presentation_state(game_id, r#"{"tree":"sneaky"}"#)
        .await;

    let err = white.recv_kind("error").await;
    assert!(
        err["message"]
            .as_str()
            .unwrap()
            .contains("Only the presenter"),
        "expected presenter-only error, got: {}",
        err["message"]
    );
}

#[tokio::test]
async fn non_originator_cannot_take_control() {
    let ts = TestServer::start().await;
    let game_id = finish_game(&ts).await;

    let mut black = ts.ws_black().await;
    let mut white = ts.ws_white().await;

    let _ = black.join_game(game_id).await;
    let _ = white.join_game(game_id).await;

    black.start_presentation(game_id).await;
    let _ = black.recv_kind("presentation_started").await;
    let _ = white.recv_kind("presentation_started").await;

    // White (not originator) tries to take control
    white.take_control(game_id).await;

    let err = white.recv_kind("error").await;
    assert!(
        err["message"]
            .as_str()
            .unwrap()
            .contains("Only the originator"),
        "expected originator-only error, got: {}",
        err["message"]
    );
}

#[tokio::test]
async fn non_presenter_cannot_end_presentation() {
    let ts = TestServer::start().await;
    let game_id = finish_game(&ts).await;

    let mut black = ts.ws_black().await;
    let mut white = ts.ws_white().await;

    let _ = black.join_game(game_id).await;
    let _ = white.join_game(game_id).await;

    black.start_presentation(game_id).await;
    let _ = black.recv_kind("presentation_started").await;
    let _ = white.recv_kind("presentation_started").await;

    // White (not presenter) tries to end
    white.end_presentation(game_id).await;

    let err = white.recv_kind("error").await;
    assert!(
        err["message"]
            .as_str()
            .unwrap()
            .contains("Only the presenter"),
        "expected presenter-only error, got: {}",
        err["message"]
    );
}

#[tokio::test]
async fn originator_gives_control_when_not_presenting() {
    let ts = TestServer::start().await;
    let game_id = finish_game(&ts).await;

    let (spectator_id, mut spectator) = create_spectator(&ts).await;

    let mut black = ts.ws_black().await;
    let mut white = ts.ws_white().await;

    let _ = black.join_game(game_id).await;
    let _ = white.join_game(game_id).await;
    let _ = spectator.join_game(game_id).await;

    // Black starts, gives control to white
    black.start_presentation(game_id).await;
    let _ = black.recv_kind("presentation_started").await;
    let _ = white.recv_kind("presentation_started").await;
    let _ = spectator.recv_kind("presentation_started").await;

    black.give_control(game_id, ts.white_id).await;
    let _ = black.recv_kind("control_changed").await;
    let _ = white.recv_kind("control_changed").await;
    let _ = spectator.recv_kind("control_changed").await;

    // Black (originator, NOT current presenter) gives control to spectator
    black.give_control(game_id, spectator_id).await;

    let cc_b = black.recv_kind("control_changed").await;
    let cc_w = white.recv_kind("control_changed").await;
    let cc_s = spectator.recv_kind("control_changed").await;
    assert_eq!(cc_b["presenter_id"], spectator_id);
    assert_eq!(cc_w["presenter_id"], spectator_id);
    assert_eq!(cc_s["presenter_id"], spectator_id);

    // Spectator can now send snapshots
    spectator
        .send_presentation_state(game_id, r#"{"tree":"spectator_view"}"#)
        .await;

    let update_b = black.recv_kind("presentation_update").await;
    let update_w = white.recv_kind("presentation_update").await;
    assert_eq!(update_b["snapshot"], r#"{"tree":"spectator_view"}"#);
    assert_eq!(update_w["snapshot"], r#"{"tree":"spectator_view"}"#);
}

#[tokio::test]
async fn spectator_presenter_disconnect_falls_back_to_originator() {
    let ts = TestServer::start().await;
    let game_id = finish_game(&ts).await;

    let (spectator_id, mut spectator) = create_spectator(&ts).await;

    let mut black = ts.ws_black().await;
    let mut white = ts.ws_white().await;

    let _ = black.join_game(game_id).await;
    let _ = white.join_game(game_id).await;
    let _ = spectator.join_game(game_id).await;

    // Black starts, gives control to spectator
    black.start_presentation(game_id).await;
    let _ = black.recv_kind("presentation_started").await;
    let _ = white.recv_kind("presentation_started").await;
    let _ = spectator.recv_kind("presentation_started").await;

    black.give_control(game_id, spectator_id).await;
    let _ = black.recv_kind("control_changed").await;
    let _ = white.recv_kind("control_changed").await;
    let _ = spectator.recv_kind("control_changed").await;

    // Spectator disconnects — should fall back to originator (black)
    spectator.close().await;

    let cc_b = black.recv_kind("control_changed").await;
    let cc_w = white.recv_kind("control_changed").await;
    assert_eq!(
        cc_b["presenter_id"], ts.black_id,
        "control should fall back to originator"
    );
    assert_eq!(cc_w["presenter_id"], ts.black_id);
}

#[tokio::test]
async fn late_joiner_sees_pending_control_request() {
    let ts = TestServer::start().await;
    let game_id = finish_game(&ts).await;

    let mut black = ts.ws_black().await;
    let mut white = ts.ws_white().await;

    let _ = black.join_game(game_id).await;
    let _ = white.join_game(game_id).await;

    black.start_presentation(game_id).await;
    let _ = black.recv_kind("presentation_started").await;
    let _ = white.recv_kind("presentation_started").await;

    // White requests control
    white.request_control(game_id).await;
    let _ = black.recv_kind("control_requested").await;
    let _ = white.recv_kind("control_requested").await;

    // Disconnect white and reconnect — should see control_request in presentation_started
    white.close().await;
    tokio::time::sleep(std::time::Duration::from_millis(100)).await;

    let mut white2 = ts.ws_white().await;
    let _ = white2.join_game(game_id).await;

    let pres = white2.recv_kind("presentation_started").await;
    assert_eq!(pres["presenter_id"], ts.black_id);
    assert!(
        pres["control_request"].as_i64().is_some(),
        "late joiner should see pending control_request, got: {}",
        pres
    );
    assert_eq!(pres["control_request"], ts.white_id);
}

#[tokio::test]
async fn non_requester_cannot_cancel_control_request() {
    let ts = TestServer::start().await;
    let game_id = finish_game(&ts).await;

    let mut black = ts.ws_black().await;
    let mut white = ts.ws_white().await;

    let _ = black.join_game(game_id).await;
    let _ = white.join_game(game_id).await;

    black.start_presentation(game_id).await;
    let _ = black.recv_kind("presentation_started").await;
    let _ = white.recv_kind("presentation_started").await;

    // White requests control
    white.request_control(game_id).await;
    let _ = black.recv_kind("control_requested").await;
    let _ = white.recv_kind("control_requested").await;

    // Black (not the requester) tries to cancel
    black.cancel_control_request(game_id).await;

    let err = black.recv_kind("error").await;
    assert!(
        err["message"]
            .as_str()
            .unwrap()
            .contains("pending control request"),
        "expected not-your-request error, got: {}",
        err["message"]
    );
}

#[tokio::test]
async fn non_authorized_user_cannot_reject_control_request() {
    let ts = TestServer::start().await;
    let game_id = finish_game(&ts).await;

    let (_spectator_id, mut spectator) = create_spectator(&ts).await;

    let mut black = ts.ws_black().await;
    let mut white = ts.ws_white().await;

    let _ = black.join_game(game_id).await;
    let _ = white.join_game(game_id).await;
    let _ = spectator.join_game(game_id).await;

    black.start_presentation(game_id).await;
    let _ = black.recv_kind("presentation_started").await;
    let _ = white.recv_kind("presentation_started").await;
    let _ = spectator.recv_kind("presentation_started").await;

    // White requests control
    white.request_control(game_id).await;
    let _ = black.recv_kind("control_requested").await;
    let _ = white.recv_kind("control_requested").await;
    let _ = spectator.recv_kind("control_requested").await;

    // Spectator (neither presenter nor originator) tries to reject
    spectator.reject_control_request(game_id).await;

    let err = spectator.recv_kind("error").await;
    assert!(
        err["message"].as_str().unwrap().contains("Not authorized"),
        "expected authorization error, got: {}",
        err["message"]
    );
}

#[tokio::test]
async fn originator_disconnect_while_spectator_presents() {
    let ts = TestServer::start().await;
    let game_id = finish_game(&ts).await;

    let (spectator_id, mut spectator) = create_spectator(&ts).await;

    let mut black = ts.ws_black().await;
    let mut white = ts.ws_white().await;

    let _ = black.join_game(game_id).await;
    let _ = white.join_game(game_id).await;
    let _ = spectator.join_game(game_id).await;

    // Black starts, gives control to spectator
    black.start_presentation(game_id).await;
    let _ = black.recv_kind("presentation_started").await;
    let _ = white.recv_kind("presentation_started").await;
    let _ = spectator.recv_kind("presentation_started").await;

    black.give_control(game_id, spectator_id).await;
    let _ = black.recv_kind("control_changed").await;
    let _ = white.recv_kind("control_changed").await;
    let _ = spectator.recv_kind("control_changed").await;

    // Originator (black) disconnects — not the presenter, so presentation continues
    black.close().await;
    tokio::time::sleep(std::time::Duration::from_millis(100)).await;

    // Spectator can still send snapshots
    spectator
        .send_presentation_state(game_id, r#"{"tree":"still_going"}"#)
        .await;

    let update = white.recv_kind("presentation_update").await;
    assert_eq!(update["snapshot"], r#"{"tree":"still_going"}"#);

    // Now spectator disconnects too — no fallback (originator not in room) → presentation ends
    spectator.close().await;

    let ended = white.recv_kind("presentation_ended").await;
    assert_eq!(ended["game_id"], game_id);
}

#[tokio::test]
async fn give_control_to_user_not_in_room_fails() {
    let ts = TestServer::start().await;
    let game_id = finish_game(&ts).await;

    let mut black = ts.ws_black().await;
    let _ = black.join_game(game_id).await;

    black.start_presentation(game_id).await;
    let _ = black.recv_kind("presentation_started").await;

    // Try to give control to white who is not in the room
    black.give_control(game_id, ts.white_id).await;

    let err = black.recv_kind("error").await;
    assert!(
        err["message"].as_str().unwrap().contains("not in the room"),
        "expected not-in-room error, got: {}",
        err["message"]
    );
}

#[tokio::test]
async fn already_presenter_cannot_request_control() {
    let ts = TestServer::start().await;
    let game_id = finish_game(&ts).await;

    let mut black = ts.ws_black().await;
    let _ = black.join_game(game_id).await;

    black.start_presentation(game_id).await;
    let _ = black.recv_kind("presentation_started").await;

    // Presenter tries to request control from themselves
    black.request_control(game_id).await;

    let err = black.recv_kind("error").await;
    assert!(
        err["message"]
            .as_str()
            .unwrap()
            .contains("already the presenter"),
        "expected already-presenter error, got: {}",
        err["message"]
    );
}

#[tokio::test]
async fn reject_with_no_pending_request_fails() {
    let ts = TestServer::start().await;
    let game_id = finish_game(&ts).await;

    let mut black = ts.ws_black().await;
    let _ = black.join_game(game_id).await;

    black.start_presentation(game_id).await;
    let _ = black.recv_kind("presentation_started").await;

    // Reject when there's no pending request
    black.reject_control_request(game_id).await;

    let err = black.recv_kind("error").await;
    assert!(
        err["message"].as_str().unwrap().contains("No pending"),
        "expected no-pending error, got: {}",
        err["message"]
    );
}
