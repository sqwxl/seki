use super::common;
use seki_web::models::game::Game;
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
    let game_id = server
        .create_and_join_with(json!({"ranked": true, "open_to": "registered"}))
        .await;

    let mut black = server.ws_black().await;
    let mut white = server.ws_white().await;

    let _ = black.join_game(game_id).await;
    let _ = white.join_game(game_id).await;

    black.play(game_id, 0, 0).await;
    let _ = black.recv_kind("state").await;
    let _ = white.recv_kind("state").await;

    white.resign(game_id).await;
    let state_b = black.recv_kind("state").await;
    let state_w = white.recv_kind("state").await;
    assert_eq!(state_b["result"], "B+R");
    assert_eq!(state_w["result"], "B+R");

    let adjustment_count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM rating_adjustments WHERE game_id = $1")
            .bind(game_id)
            .fetch_one(&server.pool)
            .await
            .unwrap();
    let rating_applied: bool = sqlx::query_scalar("SELECT rating_applied FROM games WHERE id = $1")
        .bind(game_id)
        .fetch_one(&server.pool)
        .await
        .unwrap();
    let black_rated_games: i32 =
        sqlx::query_scalar("SELECT rated_games FROM rating_profiles WHERE user_id = $1")
            .bind(server.black_id)
            .fetch_one(&server.pool)
            .await
            .unwrap();
    let white_rated_games: i32 =
        sqlx::query_scalar("SELECT rated_games FROM rating_profiles WHERE user_id = $1")
            .bind(server.white_id)
            .fetch_one(&server.pool)
            .await
            .unwrap();

    assert_eq!(adjustment_count, 2);
    assert!(rating_applied);
    assert_eq!(black_rated_games, 1);
    assert_eq!(white_rated_games, 1);

    let game = Game::find_by_id(&server.pool, game_id).await.unwrap();
    let applied_again = seki_web::services::rating::finalize_rating(
        &server.pool,
        &game,
        "B+R",
        server.black_id,
        server.white_id,
    )
    .await
    .unwrap();
    let adjustment_count_after: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM rating_adjustments WHERE game_id = $1")
            .bind(game_id)
            .fetch_one(&server.pool)
            .await
            .unwrap();

    assert!(!applied_again);
    assert_eq!(adjustment_count_after, 2);
}

#[tokio::test]
async fn ranked_open_join_captures_snapshots_and_derived_settings() {
    let server = common::TestServer::start().await;
    let game_id = server
        .create_game_with(json!({"ranked": true, "open_to": "registered"}))
        .await;

    sqlx::query(
        "UPDATE rating_profiles SET rating = 1300.0, deviation = 90.0, volatility = 0.06, rated_games = 5 WHERE user_id = $1",
    )
    .bind(server.black_id)
    .execute(&server.pool)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO rating_profiles (user_id, rating, deviation, volatility, rated_games) VALUES ($1, 1600.0, 80.0, 0.06, 8)",
    )
    .bind(server.white_id)
    .execute(&server.pool)
    .await
    .unwrap();

    server.join_game(game_id).await;

    let row: (f64, f64, f64, f64, i32, f64, String, String) = sqlx::query_as(
        "SELECT black_rating_before, white_rating_before, black_deviation_before, white_deviation_before, derived_handicap, derived_komi, derived_color_reason, calibration_policy_version FROM games WHERE id = $1",
    )
    .bind(game_id)
    .fetch_one(&server.pool)
    .await
    .unwrap();

    assert_eq!(row.0, 1300.0);
    assert_eq!(row.1, 1600.0);
    assert_eq!(row.2, 90.0);
    assert_eq!(row.3, 80.0);
    assert_eq!(row.4, 3);
    assert_eq!(row.5, 0.5);
    assert_eq!(row.6, "lower_rating_black");
    assert_eq!(row.7, "provisional-v1");
}

#[tokio::test]
async fn ranked_open_join_assigns_lower_rating_to_black() {
    let server = common::TestServer::start().await;
    let game_id = server
        .create_game_with(json!({"ranked": true, "open_to": "registered"}))
        .await;

    sqlx::query(
        "UPDATE rating_profiles SET rating = 1600.0, deviation = 80.0, volatility = 0.06, rated_games = 8 WHERE user_id = $1",
    )
    .bind(server.black_id)
    .execute(&server.pool)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO rating_profiles (user_id, rating, deviation, volatility, rated_games) VALUES ($1, 1300.0, 90.0, 0.06, 5)",
    )
    .bind(server.white_id)
    .execute(&server.pool)
    .await
    .unwrap();

    server.join_game(game_id).await;

    let row: (i64, i64, f64, f64, i32, String, String) = sqlx::query_as(
        "SELECT black_id, white_id, black_rating_before, white_rating_before, handicap, stage, derived_color_reason FROM games WHERE id = $1",
    )
    .bind(game_id)
    .fetch_one(&server.pool)
    .await
    .unwrap();

    assert_eq!(row.0, server.white_id);
    assert_eq!(row.1, server.black_id);
    assert_eq!(row.2, 1300.0);
    assert_eq!(row.3, 1600.0);
    assert_eq!(row.4, 3);
    assert_eq!(row.5, "white_to_play");
    assert_eq!(row.6, "lower_rating_black");
}

#[tokio::test]
async fn ranked_open_join_marks_exact_rating_color_as_random() {
    let server = common::TestServer::start().await;
    let game_id = server
        .create_game_with(json!({"ranked": true, "open_to": "registered"}))
        .await;

    sqlx::query(
        "UPDATE rating_profiles SET rating = 1500.0, deviation = 80.0, volatility = 0.06, rated_games = 8 WHERE user_id = $1",
    )
    .bind(server.black_id)
    .execute(&server.pool)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO rating_profiles (user_id, rating, deviation, volatility, rated_games) VALUES ($1, 1500.0, 90.0, 0.06, 5)",
    )
    .bind(server.white_id)
    .execute(&server.pool)
    .await
    .unwrap();

    server.join_game(game_id).await;

    let row: (String, i64, i64) =
        sqlx::query_as("SELECT derived_color_reason, black_id, white_id FROM games WHERE id = $1")
            .bind(game_id)
            .fetch_one(&server.pool)
            .await
            .unwrap();

    assert_eq!(row.0, "exact_rating_random");
    assert_ne!(row.1, row.2);
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
