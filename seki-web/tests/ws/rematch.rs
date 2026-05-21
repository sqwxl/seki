use serde_json::json;

use crate::common::TestServer;

/// Play one move as black in a game where test-black is black.
async fn play_one_move(ts: &TestServer, game_id: i64) {
    let resp = ts
        .client_black
        .post(format!("http://{}/api/games/{game_id}/play", ts.addr))
        .header("Authorization", "Bearer test-black-api-token-12345")
        .json(&json!({"col": 0, "row": 0}))
        .send()
        .await
        .unwrap();
    assert!(resp.status().is_success(), "play failed: {}", resp.status());
}

/// Resign the game as black via API.
async fn resign_as_black(ts: &TestServer, game_id: i64) {
    let resp = ts
        .client_black
        .post(format!("http://{}/api/games/{game_id}/resign", ts.addr))
        .header("Authorization", "Bearer test-black-api-token-12345")
        .send()
        .await
        .unwrap();
    let status = resp.status();
    let body = resp.text().await.unwrap();
    assert!(
        status.is_success(),
        "resign failed: {} — body: {}",
        status,
        body
    );
}

/// Play one move as the active player in a ranked game.
async fn play_first_move(ts: &TestServer, game_id: i64) {
    let (black_id, white_id, stage): (Option<i64>, Option<i64>, String) =
        sqlx::query_as("SELECT black_id, white_id, stage FROM games WHERE id = $1")
            .bind(game_id)
            .fetch_one(&ts.pool)
            .await
            .unwrap();
    let mover_id = if stage == "white_to_play" {
        white_id
    } else {
        black_id
    }
    .expect("no active player");
    let token = if mover_id == ts.black_id {
        "test-black-api-token-12345"
    } else {
        "test-white-api-token-67890"
    };
    let client = if mover_id == ts.black_id {
        &ts.client_black
    } else {
        &ts.client_white
    };
    let resp = client
        .post(format!("http://{}/api/games/{game_id}/play", ts.addr))
        .header("Authorization", format!("Bearer {token}"))
        .json(&json!({"col": 0, "row": 0}))
        .send()
        .await
        .unwrap();
    let status = resp.status();
    let body = resp.text().await.unwrap();
    assert!(
        status.is_success(),
        "play first move failed: {} — body: {}",
        status,
        body
    );
}

/// Resign as a specific player by their user ID.
async fn resign_as_player(ts: &TestServer, game_id: i64, player_id: i64) {
    let token = if player_id == ts.black_id {
        "test-black-api-token-12345"
    } else {
        "test-white-api-token-67890"
    };
    let client = if player_id == ts.black_id {
        &ts.client_black
    } else {
        &ts.client_white
    };
    let resp = client
        .post(format!("http://{}/api/games/{game_id}/resign", ts.addr))
        .header("Authorization", format!("Bearer {token}"))
        .send()
        .await
        .unwrap();
    let status = resp.status();
    let body = resp.text().await.unwrap();
    assert!(
        status.is_success(),
        "resign failed for player {player_id}: {} — body: {}",
        status,
        body
    );
}

/// Rematch after resignation creates a new game with same settings.
#[tokio::test]
async fn rematch_creates_new_game() {
    let ts = TestServer::start().await;
    let game_id = ts.create_and_join().await;

    play_one_move(&ts, game_id).await;
    resign_as_black(&ts, game_id).await;

    // Rematch via API — black requests rematch, no swap
    let resp = ts
        .client_black
        .post(format!("http://{}/api/games/{game_id}/rematch", ts.addr))
        .header("Authorization", "Bearer test-black-api-token-12345")
        .json(&json!({}))
        .send()
        .await
        .unwrap();
    let status = resp.status();
    let resp_body = resp.text().await.unwrap();
    assert!(
        status.is_success(),
        "rematch failed: {} — body: {}",
        status,
        resp_body
    );
    let body: serde_json::Value = serde_json::from_str(&resp_body).unwrap();
    let new_id = body["id"].as_i64().expect("new game id");
    assert_ne!(new_id, game_id);
    assert_eq!(body["cols"].as_i64().unwrap(), 9);
    assert_eq!(body["rows"].as_i64().unwrap(), 9);

    // Black should still be black (no swap)
    assert_eq!(body["black"]["username"].as_str().unwrap(), "test-black");
    assert_eq!(body["white"]["username"].as_str().unwrap(), "test-white");
}

/// Rematch with swap_colors swaps player colors.
#[tokio::test]
async fn rematch_swap_colors() {
    let ts = TestServer::start().await;
    let game_id = ts.create_and_join().await;

    play_one_move(&ts, game_id).await;
    resign_as_black(&ts, game_id).await;

    // Rematch with swap
    let resp = ts
        .client_black
        .post(format!("http://{}/api/games/{game_id}/rematch", ts.addr))
        .header("Authorization", "Bearer test-black-api-token-12345")
        .json(&json!({"swap_colors": true}))
        .send()
        .await
        .unwrap();
    let status = resp.status();
    let resp_body = resp.text().await.unwrap();
    assert!(
        status.is_success(),
        "rematch failed: {} — body: {}",
        status,
        resp_body
    );
    let body: serde_json::Value = serde_json::from_str(&resp_body).unwrap();

    // Black should now be white and vice versa
    assert_eq!(body["white"]["username"].as_str().unwrap(), "test-black");
    assert_eq!(body["black"]["username"].as_str().unwrap(), "test-white");
}

/// Rematch of a ranked game creates a new ranked game with derived handicap/komi.
#[tokio::test]
async fn rematch_ranked_creates_ranked_game() {
    let ts = TestServer::start().await;
    let game_id = ts.create_game_with(json!({"ranked": true})).await;
    ts.join_game(game_id).await;

    play_first_move(&ts, game_id).await;
    resign_as_player(&ts, game_id, ts.black_id).await;

    let resp = ts
        .client_black
        .post(format!("http://{}/api/games/{game_id}/rematch", ts.addr))
        .header("Authorization", "Bearer test-black-api-token-12345")
        .json(&json!({}))
        .send()
        .await
        .unwrap();
    let status = resp.status();
    let resp_body = resp.text().await.unwrap();
    assert!(
        status.is_success(),
        "ranked rematch failed: {} — body: {}",
        status,
        resp_body
    );
    let body: serde_json::Value = serde_json::from_str(&resp_body).unwrap();

    let new_id = body["id"].as_i64().expect("new game id");
    assert_ne!(new_id, game_id);

    // Verify the new game is ranked by checking DB
    let ranked: bool = sqlx::query_scalar("SELECT ranked FROM games WHERE id = $1")
        .bind(new_id)
        .fetch_one(&ts.pool)
        .await
        .unwrap();
    assert!(ranked, "rematch of ranked game should be ranked");

    // Derived handicap and komi should be populated
    let derived_handicap: Option<i32> =
        sqlx::query_scalar("SELECT derived_handicap FROM games WHERE id = $1")
            .bind(new_id)
            .fetch_one(&ts.pool)
            .await
            .unwrap();
    assert!(derived_handicap.is_some(), "should have derived handicap");

    let derived_komi: Option<f64> =
        sqlx::query_scalar("SELECT derived_komi FROM games WHERE id = $1")
            .bind(new_id)
            .fetch_one(&ts.pool)
            .await
            .unwrap();
    assert!(derived_komi.is_some(), "should have derived komi");
}

/// Ranked rematch ignores swap_colors — color is always determined by rating.
#[tokio::test]
async fn rematch_ranked_ignores_swap_colors() {
    let ts = TestServer::start().await;
    let game_id = ts.create_game_with(json!({"ranked": true})).await;
    ts.join_game(game_id).await;

    play_first_move(&ts, game_id).await;
    resign_as_player(&ts, game_id, ts.black_id).await;

    let resp = ts
        .client_black
        .post(format!("http://{}/api/games/{game_id}/rematch", ts.addr))
        .header("Authorization", "Bearer test-black-api-token-12345")
        .json(&json!({"swap_colors": true}))
        .send()
        .await
        .unwrap();
    let status = resp.status();
    let resp_body = resp.text().await.unwrap();
    assert!(
        status.is_success(),
        "ranked rematch with swap failed: {} — body: {}",
        status,
        resp_body
    );
    let body: serde_json::Value = serde_json::from_str(&resp_body).unwrap();

    let new_id = body["id"].as_i64().expect("new game id");

    let ranked: bool = sqlx::query_scalar("SELECT ranked FROM games WHERE id = $1")
        .bind(new_id)
        .fetch_one(&ts.pool)
        .await
        .unwrap();
    assert!(ranked);

    let color_reason: Option<String> =
        sqlx::query_scalar("SELECT derived_color_reason FROM games WHERE id = $1")
            .bind(new_id)
            .fetch_one(&ts.pool)
            .await
            .unwrap();
    assert!(
        color_reason.is_some(),
        "should have color_reason even with swap_colors"
    );
}

/// Rematch of a ranked game assigns color based on rating — lower-rated gets black.
#[tokio::test]
async fn rematch_ranked_lower_rated_gets_black() {
    let ts = TestServer::start().await;

    sqlx::query(
        "INSERT INTO rating_profiles (user_id, rating, participating) \
         VALUES ($1, 1300.0, TRUE) \
         ON CONFLICT (user_id) DO UPDATE SET rating = 1300.0",
    )
    .bind(ts.black_id)
    .execute(&ts.pool)
    .await
    .unwrap();

    let game_id = ts.create_game_with(json!({"ranked": true})).await;
    ts.join_game(game_id).await;

    play_first_move(&ts, game_id).await;
    resign_as_player(&ts, game_id, ts.black_id).await;

    let resp = ts
        .client_black
        .post(format!("http://{}/api/games/{game_id}/rematch", ts.addr))
        .header("Authorization", "Bearer test-black-api-token-12345")
        .json(&json!({}))
        .send()
        .await
        .unwrap();
    let body: serde_json::Value = resp.json().await.unwrap();

    // Lower-rated player (test-black at 1300) should be black
    assert_eq!(
        body["black"]["username"].as_str().unwrap(),
        "test-black",
        "lower-rated player should get black"
    );
    assert_eq!(body["white"]["username"].as_str().unwrap(), "test-white");

    let new_id = body["id"].as_i64().unwrap();
    let color_reason: String =
        sqlx::query_scalar("SELECT derived_color_reason FROM games WHERE id = $1")
            .bind(new_id)
            .fetch_one(&ts.pool)
            .await
            .unwrap();
    assert_eq!(color_reason, "lower_rating_black");
}

/// Ranked rematch with large rating gap assigns handicap.
#[tokio::test]
async fn rematch_ranked_assigns_handicap() {
    let ts = TestServer::start().await;

    sqlx::query(
        "INSERT INTO rating_profiles (user_id, rating, participating) \
         VALUES ($1, 1200.0, TRUE) \
         ON CONFLICT (user_id) DO UPDATE SET rating = 1200.0",
    )
    .bind(ts.black_id)
    .execute(&ts.pool)
    .await
    .unwrap();

    let game_id = ts.create_game_with(json!({"ranked": true})).await;
    ts.join_game(game_id).await;

    play_first_move(&ts, game_id).await;
    resign_as_player(&ts, game_id, ts.black_id).await;

    let resp = ts
        .client_black
        .post(format!("http://{}/api/games/{game_id}/rematch", ts.addr))
        .header("Authorization", "Bearer test-black-api-token-12345")
        .json(&json!({}))
        .send()
        .await
        .unwrap();
    let body: serde_json::Value = resp.json().await.unwrap();

    let hc = body["handicap"].as_i64().unwrap();
    assert!(
        hc >= 2,
        "expected handicap >= 2 for 300 rating gap, got {hc}"
    );
    assert!(
        (body["komi"].as_f64().unwrap() - 0.5).abs() < f64::EPSILON,
        "handicap games should have 0.5 komi"
    );
    assert_eq!(body["stage"].as_str().unwrap(), "white_to_play");

    let new_id = body["id"].as_i64().unwrap();
    let color_reason: String =
        sqlx::query_scalar("SELECT derived_color_reason FROM games WHERE id = $1")
            .bind(new_id)
            .fetch_one(&ts.pool)
            .await
            .unwrap();
    assert_eq!(color_reason, "lower_rating_black");
}
