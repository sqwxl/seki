use axum::http::Method;
use serde_json::json;

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

#[tokio::test]
async fn join_invite_only_game_with_token() {
    let ts = LightServer::start().await;
    let game_id = ts.create_private_game().await;

    // Mark as invite-only with a valid invite token.
    ts.make_game_invite_only(game_id, "invite-only-token").await;

    let access_token = ts.get_access_token(game_id).await;
    let invite_token = ts.get_invite_token(game_id).await;

    // White joins via API with both tokens
    let resp = ts
        .request(
            Method::POST,
            &format!("/api/games/{game_id}/join"),
            "test-white-api-token-67890",
            Some(&json!({
                "access_token": access_token,
                "invite_token": invite_token,
            })),
        )
        .await;
    assert!(
        resp.status().is_success(),
        "join should succeed: {}",
        resp.status()
    );
}

#[tokio::test]
async fn join_invite_only_game_without_token_rejected() {
    let ts = LightServer::start().await;
    let game_id = ts.create_private_game().await;

    // Mark as invite-only with a valid invite token.
    ts.make_game_invite_only(game_id, "invite-only-token").await;

    let access_token = ts.get_access_token(game_id).await;

    // White tries to join without invite token → 422
    let resp = ts
        .request(
            Method::POST,
            &format!("/api/games/{game_id}/join"),
            "test-white-api-token-67890",
            Some(&json!({
                "access_token": access_token,
            })),
        )
        .await;
    assert_eq!(resp.status(), 422);
}
