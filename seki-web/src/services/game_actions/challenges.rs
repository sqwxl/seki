use crate::AppState;
use crate::error::AppError;
use crate::models::game::Game;
use crate::models::rating::RatingProfile;
use crate::models::user::User;
use crate::services::{live, rating};

use super::{broadcast_game_state, load_game_and_check_player};

pub async fn accept_challenge(
    state: &AppState,
    game_id: i64,
    player_id: i64,
) -> Result<(), AppError> {
    let gwp = load_game_and_check_player(state, game_id, player_id).await?;

    if gwp.game.result.is_some() {
        return Err(AppError::UnprocessableEntity(
            "The game is over".to_string(),
        ));
    }
    if gwp.game.stage != "challenge" {
        return Err(AppError::UnprocessableEntity(
            "Game is not in challenge state".to_string(),
        ));
    }
    if gwp.game.creator_id == Some(player_id) {
        return Err(AppError::UnprocessableEntity(
            "Only the challenged player can accept".to_string(),
        ));
    }

    let mut black_id = gwp.game.black_id;
    let mut white_id = gwp.game.white_id;
    let mut ranked_settings = None;

    let players_swapped = if gwp.game.ranked {
        let (current_black_id, current_white_id) = match (black_id, white_id) {
            (Some(black_id), Some(white_id)) => (black_id, white_id),
            _ => {
                return Err(AppError::UnprocessableEntity(
                    "Ranked challenges require two players".to_string(),
                ));
            }
        };
        let acceptor = User::find_by_id(&state.db, player_id).await?;
        let acceptor_profile = RatingProfile::find(&state.db, player_id).await?;
        rating::can_accept_ranked(&acceptor, acceptor_profile.as_ref())?;

        let mut black_profile = RatingProfile::get_or_create(&state.db, current_black_id).await?;
        let mut white_profile = RatingProfile::get_or_create(&state.db, current_white_id).await?;
        let should_swap = if (black_profile.rating - white_profile.rating).abs() < f64::EPSILON {
            use rand::RngExt;
            rand::rng().random_bool(0.5)
        } else {
            black_profile.rating > white_profile.rating
        };

        if should_swap {
            Game::swap_players(&state.db, game_id).await?;
            std::mem::swap(&mut black_id, &mut white_id);
            std::mem::swap(&mut black_profile, &mut white_profile);
        }

        ranked_settings = Some(
            rating::RatingCalibrationPolicy::default()
                .ranked_settings(black_profile.rating, white_profile.rating),
        );

        should_swap
    } else if gwp.game.nigiri {
        use rand::RngExt;
        if rand::rng().random_bool(0.5) {
            Game::swap_players(&state.db, game_id).await?;
            true
        } else {
            false
        }
    } else {
        false
    };

    let handicap = ranked_settings
        .as_ref()
        .map_or(gwp.game.handicap, |settings| settings.handicap);
    let start_stage = if handicap >= 2 {
        "white_to_play"
    } else {
        "black_to_play"
    };
    Game::set_stage(&state.db, game_id, start_stage).await?;

    if black_id.is_some()
        && white_id.is_some()
        && let Err(e) = rating::capture_ranked_snapshot(
            &state.db,
            game_id,
            black_id.unwrap(),
            white_id.unwrap(),
            gwp.game.ranked,
        )
        .await
    {
        tracing::warn!(
            game_id,
            error = %e,
            "Failed to capture ranked snapshot on challenge acceptance"
        );
    }

    let gwp = if players_swapped || ranked_settings.is_some() {
        Game::find_with_players(&state.db, game_id).await?
    } else {
        let mut gwp = gwp;
        gwp.game.stage = start_stage.to_string();
        gwp
    };

    let engine = state
        .registry
        .get_or_init_engine(&state.db, &gwp.game)
        .await?;

    broadcast_game_state(state, &gwp, &engine).await;
    live::notify_game_updated(state, &gwp, None, &gwp.game.stage);

    Ok(())
}

pub async fn decline_challenge(
    state: &AppState,
    game_id: i64,
    player_id: i64,
) -> Result<(), AppError> {
    let gwp = load_game_and_check_player(state, game_id, player_id).await?;

    if gwp.game.result.is_some() {
        return Err(AppError::UnprocessableEntity(
            "The game is over".to_string(),
        ));
    }
    if gwp.game.stage != "challenge" {
        return Err(AppError::UnprocessableEntity(
            "Game is not in challenge state".to_string(),
        ));
    }
    if gwp.game.creator_id == Some(player_id) {
        return Err(AppError::UnprocessableEntity(
            "Only the challenged player can decline".to_string(),
        ));
    }

    Game::set_ended(&state.db, game_id, "Declined", "declined").await?;

    live::notify_game_removed(state, game_id);

    // Broadcast updated state to anyone watching
    let mut gwp = gwp;
    gwp.game.result = Some("Declined".to_string());
    gwp.game.stage = "declined".to_string();
    if let Ok(engine) = state
        .registry
        .get_or_init_engine(&state.db, &gwp.game)
        .await
    {
        broadcast_game_state(state, &gwp, &engine).await;
    }

    Ok(())
}
