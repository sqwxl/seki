use rand::RngExt;

use crate::AppState;
use crate::error::AppError;
use crate::models::game::Game;
use crate::models::rating::RatingProfile;
use crate::models::user::User;
use crate::services::game_creator::{self, CreateGameParams, RatingRangePreference};
use crate::services::live;
use crate::services::rating::{self, RatingCalibrationPolicy};

pub async fn rematch_game(
    state: &AppState,
    player: &User,
    game_id: i64,
    swap_colors: bool,
) -> Result<i64, AppError> {
    let gwp = Game::find_with_players(&state.db, game_id).await?;

    if gwp.game.result.is_none() {
        return Err(AppError::UnprocessableEntity(
            "Game is not finished".to_string(),
        ));
    }
    if !gwp.has_player(player.id) {
        return Err(AppError::UnprocessableEntity(
            "You are not a player in this game".to_string(),
        ));
    }

    let was_black = gwp.game.black_id == Some(player.id);
    let opponent_id = if was_black {
        gwp.game.white_id
    } else {
        gwp.game.black_id
    }
    .ok_or_else(|| AppError::UnprocessableEntity("Opponent not found".to_string()))?;

    let new_id = if gwp.game.ranked {
        ranked_rematch(state, player, &gwp, opponent_id).await?
    } else {
        unranked_rematch(state, player, &gwp, opponent_id, was_black, swap_colors).await?
    };

    if let Ok(gwp) = Game::find_with_players(&state.db, new_id).await {
        live::notify_game_created(state, &gwp);
    }

    Ok(new_id)
}

async fn ranked_rematch(
    state: &AppState,
    player: &User,
    gwp: &crate::models::game::GameWithPlayers,
    opponent_id: i64,
) -> Result<i64, AppError> {
    let opponent = User::find_by_id(&state.db, opponent_id).await?;
    let opponent_profile = RatingProfile::get_or_create(&state.db, opponent_id).await?;
    rating::can_join_ranked(&opponent, Some(&opponent_profile))?;

    let (user_profile, opp_profile) = tokio::try_join!(
        RatingProfile::get_or_create(&state.db, player.id),
        RatingProfile::get_or_create(&state.db, opponent_id),
    )?;

    let (black_id, white_id, black_rating, white_rating) =
        if (user_profile.rating - opp_profile.rating).abs() < f64::EPSILON {
            if rand::rng().random_bool(0.5) {
                (
                    player.id,
                    opponent_id,
                    user_profile.rating,
                    opp_profile.rating,
                )
            } else {
                (
                    opponent_id,
                    player.id,
                    opp_profile.rating,
                    user_profile.rating,
                )
            }
        } else if user_profile.rating < opp_profile.rating {
            (
                player.id,
                opponent_id,
                user_profile.rating,
                opp_profile.rating,
            )
        } else {
            (
                opponent_id,
                player.id,
                opp_profile.rating,
                user_profile.rating,
            )
        };

    let settings = RatingCalibrationPolicy::default().ranked_settings(black_rating, white_rating);

    let params = CreateGameParams {
        cols: gwp.game.cols,
        rows: gwp.game.rows,
        komi: 6.5,
        handicap: 0,
        is_private: false,
        allow_undo: gwp.game.allow_undo,
        color: "black".to_string(),
        invite_email: None,
        invite_username: None,
        time_control: gwp.game.time_control,
        main_time_secs: gwp.game.main_time_secs,
        increment_secs: gwp.game.increment_secs,
        byoyomi_time_secs: gwp.game.byoyomi_time_secs,
        byoyomi_periods: gwp.game.byoyomi_periods,
        open_to: None,
        ranked: true,
        rating_range: RatingRangePreference::Unlimited,
        open_game: false,
    };

    let game = game_creator::create_game(&state.db, player, params).await?;

    let stage = if settings.handicap >= 2 {
        "white_to_play"
    } else {
        "black_to_play"
    };

    let mut tx = state.db.begin().await?;
    Game::set_opponent(&mut *tx, game.id, opponent_id).await?;
    Game::set_black(&mut *tx, game.id, black_id).await?;
    Game::set_white(&mut *tx, game.id, white_id).await?;
    Game::set_stage(&mut *tx, game.id, stage).await?;
    tx.commit().await?;

    if let Err(e) =
        rating::capture_ranked_snapshot(&state.db, game.id, black_id, white_id, true).await
    {
        tracing::warn!(game_id = game.id, error = %e, "Failed to capture ranked snapshot on rematch");
    }

    Ok(game.id)
}

async fn unranked_rematch(
    state: &AppState,
    player: &User,
    gwp: &crate::models::game::GameWithPlayers,
    opponent_id: i64,
    was_black: bool,
    swap_colors: bool,
) -> Result<i64, AppError> {
    let color = match (was_black, swap_colors) {
        (true, false) | (false, true) => "black",
        (true, true) | (false, false) => "white",
    };

    let params = CreateGameParams {
        cols: gwp.game.cols,
        rows: gwp.game.rows,
        komi: gwp.game.komi,
        handicap: gwp.game.handicap,
        is_private: gwp.game.is_private,
        allow_undo: gwp.game.allow_undo,
        color: color.to_string(),
        invite_email: None,
        invite_username: None,
        time_control: gwp.game.time_control,
        main_time_secs: gwp.game.main_time_secs,
        increment_secs: gwp.game.increment_secs,
        byoyomi_time_secs: gwp.game.byoyomi_time_secs,
        byoyomi_periods: gwp.game.byoyomi_periods,
        open_to: None,
        ranked: false,
        rating_range: RatingRangePreference::Unlimited,
        open_game: false,
    };

    let game = game_creator::create_game(&state.db, player, params).await?;

    let mut tx = state.db.begin().await?;
    Game::set_opponent(&mut *tx, game.id, opponent_id).await?;
    if game.black_id.is_none() {
        Game::set_black(&mut *tx, game.id, opponent_id).await?;
    } else if game.white_id.is_none() {
        Game::set_white(&mut *tx, game.id, opponent_id).await?;
    }
    if game.stage == "unstarted" {
        Game::set_stage(&mut *tx, game.id, "challenge").await?;
    }
    tx.commit().await?;

    Ok(game.id)
}
