use crate::common::TestServer;

#[tokio::test]
async fn private_game_returns_403_without_token() {
    let ts = TestServer::start().await;
    let game_id = ts.create_private_game().await;

    // Spectator tries to view without token → 403
    let resp = ts
        .client_spectator
        .get(format!("http://{}/games/{game_id}", ts.addr))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status().as_u16(), 303);
    assert_eq!(
        resp.headers()
            .get(reqwest::header::LOCATION)
            .and_then(|value| value.to_str().ok()),
        Some("/games")
    );
}

#[tokio::test]
async fn private_game_accessible_with_valid_token() {
    let ts = TestServer::start().await;
    let game_id = ts.create_private_game().await;
    let token = ts.get_access_token(game_id).await;

    let resp = ts
        .client_spectator
        .get(format!(
            "http://{}/games/{game_id}?access_token={token}",
            ts.addr
        ))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status().as_u16(), 200);
}

#[tokio::test]
async fn private_game_accessible_to_player() {
    let ts = TestServer::start().await;
    let game_id = ts.create_private_game().await;

    // Creator (black) can view without token
    let resp = ts
        .client_black
        .get(format!("http://{}/games/{game_id}", ts.addr))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status().as_u16(), 200);
}

#[tokio::test]
async fn join_invite_only_game_with_token() {
    let ts = TestServer::start().await;
    let game_id = ts.create_private_game().await;

    // Mark as invite-only with a valid invite token.
    ts.make_game_invite_only(game_id, "invite-only-token").await;

    let access_token = ts.get_access_token(game_id).await;
    let token = ts.get_invite_token(game_id).await;

    // White joins via web POST with token query param → redirect (303)
    let resp = ts
        .client_white
        .post(format!(
            "http://{}/games/{game_id}/join?access_token={}&invite_token={token}",
            ts.addr, access_token
        ))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status().as_u16(), 303);
}

#[tokio::test]
async fn join_invite_only_game_without_token_rejected() {
    let ts = TestServer::start().await;
    let game_id = ts.create_private_game().await;

    // Mark as invite-only with a valid invite token.
    ts.make_game_invite_only(game_id, "invite-only-token").await;

    // White tries to join without token → 422
    let resp = ts
        .client_white
        .post(format!(
            "http://{}/games/{game_id}/join?access_token={}",
            ts.addr,
            ts.get_access_token(game_id).await
        ))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status().as_u16(), 422);
}
