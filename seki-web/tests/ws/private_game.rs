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
    assert_eq!(resp.status().as_u16(), 403);
}

#[tokio::test]
async fn private_game_accessible_with_valid_token() {
    let ts = TestServer::start().await;
    let game_id = ts.create_private_game().await;
    let token = ts.get_invite_token(game_id).await;

    let resp = ts
        .client_spectator
        .get(format!("http://{}/games/{game_id}?token={token}", ts.addr))
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

    // Mark as invite-only
    sqlx::query("UPDATE games SET invite_only = true WHERE id = $1")
        .bind(game_id)
        .execute(&ts.pool)
        .await
        .unwrap();

    let token = ts.get_invite_token(game_id).await;

    // White joins via web POST with token query param → redirect (303)
    let resp = ts
        .client_white
        .post(format!(
            "http://{}/games/{game_id}/join?token={token}",
            ts.addr
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

    // Mark as invite-only
    sqlx::query("UPDATE games SET invite_only = true WHERE id = $1")
        .bind(game_id)
        .execute(&ts.pool)
        .await
        .unwrap();

    // White tries to join without token → 422
    let resp = ts
        .client_white
        .post(format!("http://{}/games/{game_id}/join", ts.addr))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status().as_u16(), 422);
}
