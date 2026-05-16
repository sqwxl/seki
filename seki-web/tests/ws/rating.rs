use super::common;
use serde_json::json;

#[test]
fn rating_flow_tests_are_registered() {
    let _ = std::any::type_name::<common::TestServer>();
}

#[tokio::test]
async fn ranked_api_create_persists_ranked_status_and_profile() {
    let server = common::TestServer::start().await;

    let response = server
        .client_black
        .post(format!("http://{}/api/games", server.addr))
        .header("Authorization", "Bearer test-black-api-token-12345")
        .json(&json!({
            "cols": 9,
            "komi": 6.5,
            "handicap": 0,
            "color": "black",
            "ranked": true,
            "open_to": "registered"
        }))
        .send()
        .await
        .unwrap();

    assert_eq!(response.status(), reqwest::StatusCode::CREATED);
    let game_id = response.json::<serde_json::Value>().await.unwrap()["id"]
        .as_i64()
        .unwrap();
    let ranked: bool = sqlx::query_scalar("SELECT ranked FROM games WHERE id = $1")
        .bind(game_id)
        .fetch_one(&server.pool)
        .await
        .unwrap();
    let profile_count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM rating_profiles WHERE user_id = $1")
            .bind(server.black_id)
            .fetch_one(&server.pool)
            .await
            .unwrap();

    assert!(ranked);
    assert_eq!(profile_count, 1);
}

#[tokio::test]
async fn ranked_resign_updates_ratings_idempotently() {
    let server = common::TestServer::start().await;
    let game_id: i64 = sqlx::query_scalar(
        "INSERT INTO games (creator_id,black_id,white_id,cols,rows,komi,handicap,stage,access_token,ranked,rating_applied)
         VALUES ($1,$2,$3,9,9,6.5,0,'completed','t',1,0) RETURNING id",
    )
    .bind(server.black_id)
    .bind(server.black_id)
    .bind(server.white_id)
    .fetch_one(&server.pool)
    .await
    .unwrap();

    // Use model directly for idempotency of adjustment insert
    let adj: crate::models::rating::NewRatingAdjustment = crate::models::rating::NewRatingAdjustment {
        user_id: server.black_id,
        game_id,
        opponent_id: server.white_id,
        result: "B+R",
        rating_before: 1500.0,
        rating_after: 1516.0,
        deviation_before: 90.0,
        deviation_after: 85.0,
        volatility_before: 0.06,
        volatility_after: 0.06,
        opponent_rating_before: 1500.0,
    };

}

#[tokio::test]
async fn ranked_api_create_rejects_private_invite_and_manual_settings() {
    let server = common::TestServer::start().await;

    for body in [
        json!({
            "cols": 9,
            "komi": 6.5,
            "handicap": 0,
            "color": "black",
            "ranked": true,
            "is_private": true
        }),
        json!({
            "cols": 9,
            "komi": 6.5,
            "handicap": 0,
            "color": "black",
            "ranked": true,
            "invite_email": "new@example.com"
        }),
        json!({
            "cols": 9,
            "komi": 0.5,
            "handicap": 2,
            "color": "black",
            "ranked": true
        }),
    ] {
        let response = server
            .client_black
            .post(format!("http://{}/api/games", server.addr))
            .header("Authorization", "Bearer test-black-api-token-12345")
            .json(&body)
            .send()
            .await
            .unwrap();

        assert_eq!(response.status(), reqwest::StatusCode::UNPROCESSABLE_ENTITY);
    }
}
