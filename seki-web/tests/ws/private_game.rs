use axum::http::Method;

use crate::common::LightServer;

#[tokio::test]
async fn private_game_returns_not_found_without_token() {
    let ts = LightServer::start().await;
    let game_id = ts.create_private_game().await;

    // Spectator tries to view without token → 404 (API returns not found for private games)
    let resp = ts
        .request_no_auth(Method::GET, &format!("/api/games/{game_id}"), None)
        .await;
    assert_eq!(resp.status(), 404);
}

#[tokio::test]
async fn private_game_accessible_with_valid_token() {
    let ts = LightServer::start().await;
    let game_id = ts.create_private_game().await;
    let token = ts.get_access_token(game_id).await;

    let resp = ts
        .request_no_auth(
            Method::GET,
            &format!("/api/games/{game_id}?access_token={token}"),
            None,
        )
        .await;
    assert_eq!(resp.status(), 200);
}

#[tokio::test]
async fn private_game_accessible_to_player() {
    let ts = LightServer::start().await;
    let game_id = ts.create_private_game().await;

    // Creator (black) can view without token
    let resp = ts
        .request(
            Method::GET,
            &format!("/api/games/{game_id}"),
            "test-black-api-token-12345",
            None,
        )
        .await;
    assert_eq!(resp.status(), 200);
}
