use serde_json::json;

use crate::common::TestServer;

// -- Board Size Validation --

#[tokio::test]
async fn reject_board_size_below_minimum() {
    let server = TestServer::start().await;

    let resp = server.try_create_game_with(json!({"cols": 1, "rows": 9})).await;
    assert_eq!(resp.status(), 422);
    let body: serde_json::Value = resp.json().await.unwrap();
    assert!(body["error"].as_str().unwrap().contains("width"));

    let resp = server.try_create_game_with(json!({"cols": 9, "rows": 1})).await;
    assert_eq!(resp.status(), 422);
    let body: serde_json::Value = resp.json().await.unwrap();
    assert!(body["error"].as_str().unwrap().contains("height"));
}

#[tokio::test]
async fn reject_board_size_above_maximum() {
    let server = TestServer::start().await;

    let resp = server.try_create_game_with(json!({"cols": 42, "rows": 19})).await;
    assert_eq!(resp.status(), 422);
    let body: serde_json::Value = resp.json().await.unwrap();
    assert!(body["error"].as_str().unwrap().contains("width"));

    let resp = server.try_create_game_with(json!({"cols": 19, "rows": 50})).await;
    assert_eq!(resp.status(), 422);
    let body: serde_json::Value = resp.json().await.unwrap();
    assert!(body["error"].as_str().unwrap().contains("height"));
}

#[tokio::test]
async fn reject_negative_board_dimensions() {
    let server = TestServer::start().await;

    let resp = server.try_create_game_with(json!({"cols": -5, "rows": 9})).await;
    assert_eq!(resp.status(), 422);

    let resp = server.try_create_game_with(json!({"cols": 9, "rows": -10})).await;
    assert_eq!(resp.status(), 422);
}

#[tokio::test]
async fn reject_zero_board_dimensions() {
    let server = TestServer::start().await;

    let resp = server.try_create_game_with(json!({"cols": 0, "rows": 9})).await;
    assert_eq!(resp.status(), 422);

    let resp = server.try_create_game_with(json!({"cols": 9, "rows": 0})).await;
    assert_eq!(resp.status(), 422);
}

#[tokio::test]
async fn accept_valid_board_sizes() {
    let server = TestServer::start().await;

    // Minimum size
    let resp = server.try_create_game_with(json!({"cols": 2, "rows": 2})).await;
    assert!(resp.status().is_success(), "2x2 board should be valid");

    // Standard sizes
    let resp = server.try_create_game_with(json!({"cols": 19, "rows": 19})).await;
    assert!(resp.status().is_success(), "19x19 board should be valid");

    // Maximum size
    let resp = server.try_create_game_with(json!({"cols": 41, "rows": 41})).await;
    assert!(resp.status().is_success(), "41x41 board should be valid");

    // Rectangular board
    let resp = server.try_create_game_with(json!({"cols": 9, "rows": 13})).await;
    assert!(resp.status().is_success(), "9x13 board should be valid");
}

// -- Handicap Validation --

#[tokio::test]
async fn reject_negative_handicap() {
    let server = TestServer::start().await;

    let resp = server.try_create_game_with(json!({"handicap": -1})).await;
    assert_eq!(resp.status(), 422);
    let body: serde_json::Value = resp.json().await.unwrap();
    assert!(body["error"].as_str().unwrap().contains("negative"));
}

#[tokio::test]
async fn reject_handicap_one() {
    let server = TestServer::start().await;

    let resp = server.try_create_game_with(json!({"handicap": 1})).await;
    assert_eq!(resp.status(), 422);
    let body: serde_json::Value = resp.json().await.unwrap();
    assert!(body["error"].as_str().unwrap().contains("minimum is 2"));
}

#[tokio::test]
async fn reject_handicap_exceeds_max_for_board_size() {
    let server = TestServer::start().await;

    // 9x9 max handicap is 5
    let resp = server.try_create_game_with(json!({"cols": 9, "rows": 9, "handicap": 6})).await;
    assert_eq!(resp.status(), 422);
    let body: serde_json::Value = resp.json().await.unwrap();
    assert!(body["error"].as_str().unwrap().contains("Maximum handicap"));

    // 19x19 max handicap is 9
    let resp = server
        .try_create_game_with(json!({"cols": 19, "rows": 19, "handicap": 10}))
        .await;
    assert_eq!(resp.status(), 422);
}

#[tokio::test]
async fn reject_handicap_on_unsupported_board() {
    let server = TestServer::start().await;

    // Even board (8x8) doesn't support handicap
    let resp = server.try_create_game_with(json!({"cols": 8, "rows": 8, "handicap": 2})).await;
    assert_eq!(resp.status(), 422);
    let body: serde_json::Value = resp.json().await.unwrap();
    assert!(body["error"].as_str().unwrap().contains("not supported"));

    // Non-square board doesn't support handicap
    let resp = server.try_create_game_with(json!({"cols": 9, "rows": 13, "handicap": 2})).await;
    assert_eq!(resp.status(), 422);
}

#[tokio::test]
async fn accept_valid_handicap() {
    let server = TestServer::start().await;

    // Handicap 0 (no handicap)
    let resp = server.try_create_game_with(json!({"cols": 9, "rows": 9, "handicap": 0})).await;
    assert!(resp.status().is_success(), "handicap 0 should be valid");

    // Minimum handicap (2)
    let resp = server.try_create_game_with(json!({"cols": 9, "rows": 9, "handicap": 2})).await;
    assert!(resp.status().is_success(), "handicap 2 should be valid");

    // Maximum handicap for 9x9 (5)
    let resp = server.try_create_game_with(json!({"cols": 9, "rows": 9, "handicap": 5})).await;
    assert!(resp.status().is_success(), "handicap 5 on 9x9 should be valid");

    // Maximum handicap for 19x19 (9)
    let resp = server
        .try_create_game_with(json!({"cols": 19, "rows": 19, "handicap": 9}))
        .await;
    assert!(resp.status().is_success(), "handicap 9 on 19x19 should be valid");
}

// -- Komi Validation --

#[tokio::test]
async fn reject_integer_komi_zero() {
    let server = TestServer::start().await;

    let resp = server.try_create_game_with(json!({"komi": 0})).await;
    assert_eq!(resp.status(), 422);
    let body: serde_json::Value = resp.json().await.unwrap();
    assert!(body["error"].as_str().unwrap().contains("half-integer"));
}

#[tokio::test]
async fn reject_integer_komi_positive() {
    let server = TestServer::start().await;

    let resp = server.try_create_game_with(json!({"komi": 7})).await;
    assert_eq!(resp.status(), 422);
    let body: serde_json::Value = resp.json().await.unwrap();
    assert!(body["error"].as_str().unwrap().contains("half-integer"));
}

#[tokio::test]
async fn reject_integer_komi_negative() {
    let server = TestServer::start().await;

    let resp = server.try_create_game_with(json!({"komi": -5})).await;
    assert_eq!(resp.status(), 422);
    let body: serde_json::Value = resp.json().await.unwrap();
    assert!(body["error"].as_str().unwrap().contains("half-integer"));
}

#[tokio::test]
async fn accept_half_integer_komi() {
    let server = TestServer::start().await;

    // Positive half-integer
    let resp = server.try_create_game_with(json!({"komi": 6.5})).await;
    assert!(resp.status().is_success(), "komi 6.5 should be valid");

    // Negative half-integer
    let resp = server.try_create_game_with(json!({"komi": -3.5})).await;
    assert!(resp.status().is_success(), "komi -3.5 should be valid");

    // Zero-point-five
    let resp = server.try_create_game_with(json!({"komi": 0.5})).await;
    assert!(resp.status().is_success(), "komi 0.5 should be valid");

    // Negative zero-point-five
    let resp = server.try_create_game_with(json!({"komi": -0.5})).await;
    assert!(resp.status().is_success(), "komi -0.5 should be valid");
}
