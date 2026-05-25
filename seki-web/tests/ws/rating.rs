use super::common;
use seki_web::models::game::Game;
use seki_web::models::rating::RatingProfile;
use seki_web::models::user::User;
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
            "ranked": true,
            "open_to": "registered",
            "time_control": "fischer",
            "main_time_secs": 600,
            "increment_secs": 5
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

    let mut black = server.ws_black().await;
    let mut white = server.ws_white().await;

    let _ = black.join_game(game_id).await;
    let _ = white.join_game(game_id).await;

    // Handicap game with 300 point gap: white plays first
    white.play(game_id, 0, 0).await;
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
    assert_eq!(black_rated_games, 6);
    assert_eq!(white_rated_games, 9);

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

    let mut black = server.ws_black().await;
    let init = black.recv_kind("init").await;
    let lobby_game = init["player_games"]
        .as_array()
        .unwrap()
        .iter()
        .find(|game| game["id"].as_i64() == Some(game_id))
        .expect("ranked game missing from lobby init");
    assert_eq!(lobby_game["settings"]["ranked"], true);
    assert_eq!(lobby_game["settings"]["rating_status"], "ranked");
    assert_eq!(lobby_game["settings"]["color_reason"], "lower_rating_black");
    assert_eq!(lobby_game["black"]["rank"]["status"], "ranked");
    assert_eq!(
        lobby_game["black"]["rank"]["rating"].as_f64().unwrap(),
        1300.0
    );

    let state = black.join_game(game_id).await;
    assert_eq!(state["settings"]["ranked"], true);
    assert_eq!(state["settings"]["rating_status"], "ranked");
    assert_eq!(state["settings"]["handicap"], 3);
    assert_eq!(state["komi"].as_f64().unwrap(), 0.5);
    assert_eq!(state["settings"]["color_reason"], "lower_rating_black");
    assert_eq!(
        state["settings"]["rating_snapshots"]["black"]["rating"]
            .as_f64()
            .unwrap(),
        1300.0
    );
    assert_eq!(state["black"]["rank"]["status"], "ranked");
    assert_eq!(state["black"]["rank"]["qualifier"], "10k");
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
async fn ranked_challenge_accept_derives_color_handicap_and_stage() {
    let server = common::TestServer::start().await;

    sqlx::query(
        "INSERT INTO rating_profiles (user_id, rating, deviation, volatility, rated_games) VALUES ($1, 1600.0, 80.0, 0.06, 8)",
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

    let game_id = server
        .create_game_with(json!({
            "ranked": true,
            "invite_username": "test-white"
        }))
        .await;

    let response = server
        .client_white
        .post(format!("http://{}/api/games/{game_id}/accept", server.addr))
        .header("Authorization", "Bearer test-white-api-token-67890")
        .send()
        .await
        .unwrap();
    assert!(response.status().is_success());

    let row: (i64, i64, i32, f64, String, String) = sqlx::query_as(
        "SELECT black_id, white_id, handicap, komi, stage, derived_color_reason FROM games WHERE id = $1",
    )
    .bind(game_id)
    .fetch_one(&server.pool)
    .await
    .unwrap();

    assert_eq!(row.0, server.white_id);
    assert_eq!(row.1, server.black_id);
    assert_eq!(row.2, 3);
    assert_eq!(row.3, 0.5);
    assert_eq!(row.4, "white_to_play");
    assert_eq!(row.5, "lower_rating_black");
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

#[tokio::test]
async fn ranked_web_create_and_join_reject_anonymous_users() {
    let server = common::TestServer::start().await;
    let anonymous = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .cookie_store(true)
        .build()
        .unwrap();

    let create_response = anonymous
        .post(format!("http://{}/games", server.addr))
        .header(reqwest::header::ACCEPT, "application/json")
        .form(&[
            ("cols", "9"),
            ("komi", "6.5"),
            ("handicap", "0"),
            ("color", "black"),
            ("ranked", "true"),
        ])
        .send()
        .await
        .unwrap();
    assert_eq!(
        create_response.status(),
        reqwest::StatusCode::UNPROCESSABLE_ENTITY
    );

    let game_id = server
        .create_game_with(json!({"ranked": true, "open_to": "registered"}))
        .await;
    let join_response = anonymous
        .post(format!("http://{}/games/{game_id}/join", server.addr))
        .header(reqwest::header::ACCEPT, "application/json")
        .send()
        .await
        .unwrap();
    assert_eq!(
        join_response.status(),
        reqwest::StatusCode::UNPROCESSABLE_ENTITY
    );
}

#[tokio::test]
async fn ranked_api_create_allows_direct_email_challenge_for_existing_user() {
    let server = common::TestServer::start().await;
    sqlx::query("UPDATE users SET email = $1 WHERE id = $2")
        .bind("white@example.com")
        .bind(server.white_id)
        .execute(&server.pool)
        .await
        .unwrap();

    let response = server
        .client_black
        .post(format!("http://{}/api/games", server.addr))
        .header("Authorization", "Bearer test-black-api-token-12345")
        .json(&json!({
            "cols": 9,
            "ranked": true,
            "invite_email": "white@example.com",
            "time_control": "fischer",
            "main_time_secs": 600,
            "increment_secs": 5
        }))
        .send()
        .await
        .unwrap();

    assert_eq!(response.status(), reqwest::StatusCode::CREATED);
    let body = response.json::<serde_json::Value>().await.unwrap();
    let game_id = body["id"].as_i64().unwrap();
    let (ranked, white_id, stage): (bool, Option<i64>, String) =
        sqlx::query_as("SELECT ranked, white_id, stage FROM games WHERE id = $1")
            .bind(game_id)
            .fetch_one(&server.pool)
            .await
            .unwrap();
    assert!(ranked);
    assert_eq!(white_id, Some(server.white_id));
    assert_eq!(stage, "challenge");
}

#[tokio::test]
async fn web_user_rank_dtos_cover_rating_states() {
    let server = common::TestServer::start().await;
    let registered = User::find_by_id(&server.pool, server.black_id)
        .await
        .unwrap();
    let anonymous = User::create(&server.pool).await.unwrap();

    let anonymous_rank = seki_web::views::user_data_from_user_with_rank(&anonymous, None)
        .rank
        .unwrap();
    assert_eq!(
        anonymous_rank.status,
        seki_web::services::rating::RankStatus::Anonymous
    );

    let unranked_without_profile =
        seki_web::views::user_data_from_user_with_rank(&registered, None)
            .rank
            .unwrap();
    assert_eq!(
        unranked_without_profile.status,
        seki_web::services::rating::RankStatus::Unranked
    );
    assert_eq!(unranked_without_profile.qualifier.as_deref(), Some("?"));

    let mut profile = RatingProfile::get_or_create(&server.pool, server.black_id)
        .await
        .unwrap();
    let unranked = seki_web::views::user_data_from_user_with_rank(&registered, Some(&profile))
        .rank
        .unwrap();
    assert_eq!(
        unranked.status,
        seki_web::services::rating::RankStatus::Unranked
    );

    RatingProfile::set_participating(&server.pool, server.black_id, false)
        .await
        .unwrap();
    profile = RatingProfile::find(&server.pool, server.black_id)
        .await
        .unwrap()
        .unwrap();
    let not_participating =
        seki_web::views::user_data_from_user_with_rank(&registered, Some(&profile))
            .rank
            .unwrap();
    assert_eq!(
        not_participating.status,
        seki_web::services::rating::RankStatus::NotParticipating
    );

    sqlx::query(
        "UPDATE rating_profiles SET participating = true, rated_games = 1, rating = 1560.0, deviation = 120.0 WHERE user_id = $1",
    )
    .bind(server.black_id)
    .execute(&server.pool)
    .await
    .unwrap();
    profile = RatingProfile::find(&server.pool, server.black_id)
        .await
        .unwrap()
        .unwrap();
    let ranked = seki_web::views::user_data_from_user_with_rank(&registered, Some(&profile))
        .rank
        .unwrap();
    assert_eq!(
        ranked.status,
        seki_web::services::rating::RankStatus::Ranked
    );
    assert_eq!(ranked.rating, Some(1560.0));
    assert!(ranked.uncertain);
    assert!(ranked.qualifier.is_some());
}

#[tokio::test]
async fn rating_display_preference_patch_validates_values() {
    let server = common::TestServer::start().await;

    let response = server
        .client_black
        .patch(format!("http://{}/settings/preferences", server.addr))
        .json(&json!({"rating_display": "rating"}))
        .send()
        .await
        .unwrap();
    assert!(response.status().is_success());
    let body = response.json::<serde_json::Value>().await.unwrap();
    assert_eq!(body["rating_display"], "rating");

    let response = server
        .client_black
        .patch(format!("http://{}/settings/preferences", server.addr))
        .json(&json!({"rating_display": "invalid"}))
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), reqwest::StatusCode::UNPROCESSABLE_ENTITY);

    let response = server
        .client_black
        .patch(format!("http://{}/settings/preferences", server.addr))
        .json(&json!({"rating_participating": false}))
        .send()
        .await
        .unwrap();
    assert!(response.status().is_success());
    let body = response.json::<serde_json::Value>().await.unwrap();
    assert_eq!(body["rating_participating"], false);
}

#[tokio::test]
async fn rating_opt_out_blocks_future_ranked_create_and_join() {
    let server = common::TestServer::start().await;
    RatingProfile::set_participating(&server.pool, server.black_id, false)
        .await
        .unwrap();

    let response = server.try_create_game_with(json!({"ranked": true})).await;
    assert_eq!(response.status(), reqwest::StatusCode::UNPROCESSABLE_ENTITY);

    RatingProfile::set_participating(&server.pool, server.black_id, true)
        .await
        .unwrap();
    let game_id = server
        .create_game_with(json!({"ranked": true, "open_to": "registered"}))
        .await;
    RatingProfile::set_participating(&server.pool, server.white_id, false)
        .await
        .unwrap();

    let response = server
        .client_white
        .post(format!("http://{}/api/games/{game_id}/join", server.addr))
        .header("Authorization", "Bearer test-white-api-token-67890")
        .json(&json!({}))
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), reqwest::StatusCode::UNPROCESSABLE_ENTITY);
}

#[tokio::test]
async fn rating_opt_out_preserves_in_progress_ranked_game_eligibility() {
    let server = common::TestServer::start().await;
    let game_id = server
        .create_game_with(json!({"ranked": true, "open_to": "registered"}))
        .await;
    server.join_game(game_id).await;

    RatingProfile::set_participating(&server.pool, server.black_id, false)
        .await
        .unwrap();
    RatingProfile::set_participating(&server.pool, server.white_id, false)
        .await
        .unwrap();

    let game = Game::find_by_id(&server.pool, game_id).await.unwrap();
    let applied = seki_web::services::rating::finalize_rating(
        &server.pool,
        &game,
        "B+R",
        game.black_id.unwrap(),
        game.white_id.unwrap(),
    )
    .await
    .unwrap();
    assert!(applied);

    let adjustment_count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM rating_adjustments WHERE game_id = $1")
            .bind(game_id)
            .fetch_one(&server.pool)
            .await
            .unwrap();
    assert_eq!(adjustment_count, 2);
}

#[tokio::test]
async fn profile_rating_history_lists_chronological_adjustments() {
    let server = common::TestServer::start().await;
    let game_id = server
        .create_game_with(json!({"ranked": true, "open_to": "registered"}))
        .await;
    server.join_game(game_id).await;
    let game = Game::find_by_id(&server.pool, game_id).await.unwrap();

    seki_web::services::rating::finalize_rating(
        &server.pool,
        &game,
        "B+R",
        game.black_id.unwrap(),
        game.white_id.unwrap(),
    )
    .await
    .unwrap();

    let response = server
        .client_black
        .get(format!("http://{}/api/web/users/test-black", server.addr))
        .send()
        .await
        .unwrap();
    assert!(response.status().is_success());
    let body = response.json::<serde_json::Value>().await.unwrap();
    let history = body["rating"]["history"].as_array().unwrap();

    assert_eq!(history.len(), 1);
    assert_eq!(history[0]["game_id"], game_id);
    assert_eq!(history[0]["result"], "B+R");
    assert!(history[0]["rating_before"].is_number());
    assert!(history[0]["rating_after"].is_number());
    assert!(history[0]["deviation_before"].is_number());
    assert!(history[0]["deviation_after"].is_number());
    assert!(history[0]["volatility_before"].is_number());
    assert!(history[0]["volatility_after"].is_number());
    assert!(history[0]["rating_delta"].is_number());
    assert!(history[0]["created_at"].is_string());
}

#[tokio::test]
async fn profile_rating_history_survives_username_change_and_opt_out() {
    let server = common::TestServer::start().await;
    let game_id = server
        .create_game_with(json!({"ranked": true, "open_to": "registered"}))
        .await;
    server.join_game(game_id).await;
    let game = Game::find_by_id(&server.pool, game_id).await.unwrap();

    seki_web::services::rating::finalize_rating(
        &server.pool,
        &game,
        "B+R",
        game.black_id.unwrap(),
        game.white_id.unwrap(),
    )
    .await
    .unwrap();
    User::update_username(&server.pool, server.black_id, "renamed-black")
        .await
        .unwrap();
    RatingProfile::set_participating(&server.pool, server.black_id, false)
        .await
        .unwrap();

    let response = server
        .client_black
        .get(format!(
            "http://{}/api/web/users/renamed-black",
            server.addr
        ))
        .send()
        .await
        .unwrap();
    assert!(response.status().is_success());
    let body = response.json::<serde_json::Value>().await.unwrap();

    assert_eq!(body["rating"]["participating"], false);
    assert_eq!(body["rating"]["history"][0]["game_id"], game_id);
}

#[tokio::test]
async fn profile_rating_history_filters_protected_games() {
    let server = common::TestServer::start().await;
    let private_game_id = server.create_private_game().await;
    RatingProfile::get_or_create(&server.pool, server.black_id)
        .await
        .unwrap();
    sqlx::query(
        "INSERT INTO rating_adjustments \
         (user_id, game_id, opponent_id, result, rating_before, rating_after, \
          deviation_before, deviation_after, volatility_before, volatility_after, \
          rating_delta, opponent_rating_before) \
         VALUES ($1, $2, $3, 'B+R', 1500.0, 1510.0, 350.0, 340.0, 0.06, 0.06, 10.0, 1500.0)",
    )
    .bind(server.black_id)
    .bind(private_game_id)
    .bind(server.white_id)
    .execute(&server.pool)
    .await
    .unwrap();

    let spectator_response = server
        .client_spectator
        .get(format!("http://{}/api/web/users/test-black", server.addr))
        .send()
        .await
        .unwrap();
    assert!(spectator_response.status().is_success());
    let spectator_body = spectator_response
        .json::<serde_json::Value>()
        .await
        .unwrap();
    assert_eq!(
        spectator_body["rating"]["history"]
            .as_array()
            .unwrap()
            .len(),
        0
    );

    let owner_response = server
        .client_black
        .get(format!("http://{}/api/web/users/test-black", server.addr))
        .send()
        .await
        .unwrap();
    assert!(owner_response.status().is_success());
    let owner_body = owner_response.json::<serde_json::Value>().await.unwrap();
    assert_eq!(
        owner_body["rating"]["history"][0]["game_id"],
        private_game_id
    );
}

#[tokio::test]
async fn game_list_filters_by_rated_status() {
    let server = common::TestServer::start().await;
    let ranked_id = server
        .create_game_with(json!({"ranked": true, "open_to": "registered"}))
        .await;
    let unranked_id = server
        .create_game_with(json!({"ranked": false, "open_to": "registered"}))
        .await;

    let ranked_resp = server
        .client_spectator
        .get(format!(
            "http://{}/api/web/games?rated_status=ranked",
            server.addr
        ))
        .send()
        .await
        .unwrap();
    assert!(ranked_resp.status().is_success());
    let ranked_body = ranked_resp.json::<serde_json::Value>().await.unwrap();
    let public_ids: Vec<i64> = ranked_body["public_games"]
        .as_array()
        .unwrap()
        .iter()
        .map(|g| g["id"].as_i64().unwrap())
        .collect();
    assert!(public_ids.contains(&ranked_id));
    assert!(!public_ids.contains(&unranked_id));

    let unranked_resp = server
        .client_spectator
        .get(format!(
            "http://{}/api/web/games?rated_status=unranked",
            server.addr
        ))
        .send()
        .await
        .unwrap();
    assert!(unranked_resp.status().is_success());
    let unranked_body = unranked_resp.json::<serde_json::Value>().await.unwrap();
    let unranked_public_ids: Vec<i64> = unranked_body["public_games"]
        .as_array()
        .unwrap()
        .iter()
        .map(|g| g["id"].as_i64().unwrap())
        .collect();
    assert!(!unranked_public_ids.contains(&ranked_id));
    assert!(unranked_public_ids.contains(&unranked_id));
}

#[tokio::test]
async fn game_list_filters_by_rating_range() {
    let server = common::TestServer::start().await;

    sqlx::query(
        "INSERT INTO rating_profiles (user_id, rating, deviation, volatility, rated_games) \
         VALUES ($1, 1200.0, 80.0, 0.06, 5) \
         ON CONFLICT (user_id) DO UPDATE SET rating = 1200.0, deviation = 80.0, volatility = 0.06",
    )
    .bind(server.black_id)
    .execute(&server.pool)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO rating_profiles (user_id, rating, deviation, volatility, rated_games) \
         VALUES ($1, 1800.0, 80.0, 0.06, 5) \
         ON CONFLICT (user_id) DO UPDATE SET rating = 1800.0, deviation = 80.0, volatility = 0.06",
    )
    .bind(server.white_id)
    .execute(&server.pool)
    .await
    .unwrap();

    let ranked_game = server
        .create_game_with(json!({"ranked": true, "open_to": "registered"}))
        .await;
    server.join_game(ranked_game).await;

    let unranked_game = server
        .create_game_with(json!({"ranked": false, "open_to": "registered"}))
        .await;

    let low_range_resp = server
        .client_spectator
        .get(format!(
            "http://{}/api/web/games?min_rating=1100&max_rating=1300",
            server.addr
        ))
        .send()
        .await
        .unwrap();
    assert!(low_range_resp.status().is_success());
    let low_body = low_range_resp.json::<serde_json::Value>().await.unwrap();
    let low_ids: Vec<i64> = low_body["public_games"]
        .as_array()
        .unwrap()
        .iter()
        .map(|g| g["id"].as_i64().unwrap())
        .collect();
    assert!(low_ids.contains(&ranked_game));
    assert!(low_ids.contains(&unranked_game));

    let no_match_resp = server
        .client_spectator
        .get(format!(
            "http://{}/api/web/games?min_rating=1301&max_rating=1799",
            server.addr
        ))
        .send()
        .await
        .unwrap();
    assert!(no_match_resp.status().is_success());
    let no_match_body = no_match_resp.json::<serde_json::Value>().await.unwrap();
    let no_match_ids: Vec<i64> = no_match_body["public_games"]
        .as_array()
        .unwrap()
        .iter()
        .map(|g| g["id"].as_i64().unwrap())
        .collect();
    assert!(!no_match_ids.contains(&ranked_game));
    assert!(no_match_ids.contains(&unranked_game));
}

#[tokio::test]
async fn ranked_open_game_rejects_out_of_range_joiner() {
    let server = common::TestServer::start().await;

    sqlx::query(
        "INSERT INTO rating_profiles (user_id, rating, deviation, volatility, rated_games) \
         VALUES ($1, 1200.0, 80.0, 0.06, 5) \
         ON CONFLICT (user_id) DO UPDATE SET rating = 1200.0, deviation = 80.0, volatility = 0.06",
    )
    .bind(server.black_id)
    .execute(&server.pool)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO rating_profiles (user_id, rating, deviation, volatility, rated_games) \
         VALUES ($1, 2000.0, 80.0, 0.06, 5) \
         ON CONFLICT (user_id) DO UPDATE SET rating = 2000.0, deviation = 80.0, volatility = 0.06",
    )
    .bind(server.white_id)
    .execute(&server.pool)
    .await
    .unwrap();

    let game_id = server
        .create_game_with(json!({"ranked": true, "open_to": "registered"}))
        .await;
    sqlx::query(
        "UPDATE games SET rating_range_mode = 'absolute', \
         max_rating_difference_lower = 3, max_rating_difference_higher = 3, \
         rating_difference_lower_unlimited = false, rating_difference_higher_unlimited = false \
         WHERE id = $1",
    )
    .bind(game_id)
    .execute(&server.pool)
    .await
    .unwrap();

    let resp = server
        .client_white
        .post(format!("http://{}/api/games/{game_id}/join", server.addr))
        .header("Authorization", "Bearer test-white-api-token-67890")
        .json(&serde_json::json!({}))
        .send()
        .await
        .unwrap();

    assert_eq!(resp.status(), 422);
}
