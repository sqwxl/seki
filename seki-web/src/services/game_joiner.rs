use rand::RngExt;

use crate::db::DbPool;
use crate::error::AppError;
use crate::models::game::Game;
use crate::models::game::GameWithPlayers;
use crate::models::pregame_settings::PregameSettingsNegotiation;
use crate::models::rating::RatingProfile;
use crate::models::user::User;
use crate::services::rating::{self, RatingCalibrationPolicy};

pub async fn join_open_game(
    pool: &DbPool,
    gwp: &GameWithPlayers,
    user: &User,
) -> Result<(), AppError> {
    if gwp.has_player(user.id) {
        return Err(AppError::UnprocessableEntity(
            "Already in this game".to_string(),
        ));
    }

    let joiner_profile = if gwp.game.ranked
        || !gwp.game.rating_difference_lower_unlimited
        || !gwp.game.rating_difference_higher_unlimited
    {
        let profile = RatingProfile::find(pool, user.id).await?;
        if gwp.game.ranked {
            rating::can_join_ranked(user, profile.as_ref())?;
        }
        profile
    } else {
        None
    };

    if gwp.game.open_to.as_deref() == Some("registered") && !user.is_registered() {
        return Err(AppError::UnprocessableEntity(
            "This game is restricted to registered users".to_string(),
        ));
    }

    let Some(creator_id) = gwp.game.creator_id else {
        return Err(AppError::UnprocessableEntity(
            "Open games require a creator".to_string(),
        ));
    };
    if gwp.game.opponent_id.is_some() {
        return Err(AppError::UnprocessableEntity("Game is full".to_string()));
    }

    if !gwp.game.ranked
        && (!gwp.game.rating_difference_lower_unlimited
            || !gwp.game.rating_difference_higher_unlimited)
        && let (Some(creator_profile), Some(joiner_profile)) = (
            RatingProfile::find(pool, creator_id).await?,
            joiner_profile.as_ref(),
        )
        && !rating::game_rating_range_allows(
            &gwp.game,
            creator_profile.rating,
            joiner_profile.rating,
        )
    {
        return Err(AppError::UnprocessableEntity(
            "This game is outside the allowed rating range".to_string(),
        ));
    }

    let mut final_black_id = None;
    let mut final_white_id = None;
    let ranked_settings = if gwp.game.ranked {
        if !gwp.game.rating_difference_lower_unlimited
            || !gwp.game.rating_difference_higher_unlimited
        {
            let creator_profile = RatingProfile::find(pool, creator_id).await?;
            let Some(joiner_profile) = joiner_profile.as_ref() else {
                return Err(AppError::UnprocessableEntity(
                    "Ranked games require player ratings".to_string(),
                ));
            };
            let Some(creator_profile) = creator_profile.as_ref() else {
                return Err(AppError::UnprocessableEntity(
                    "Ranked games require player ratings".to_string(),
                ));
            };

            if !rating::game_rating_range_allows(
                &gwp.game,
                creator_profile.rating,
                joiner_profile.rating,
            ) {
                return Err(AppError::UnprocessableEntity(
                    "This game is outside the allowed rating range".to_string(),
                ));
            }
        }

        let creator_profile = RatingProfile::get_or_create(pool, creator_id).await?;
        let joiner_profile = RatingProfile::get_or_create(pool, user.id).await?;
        let creator_black = if (creator_profile.rating - joiner_profile.rating).abs() < f64::EPSILON
        {
            rand::rng().random_bool(0.5)
        } else {
            creator_profile.rating < joiner_profile.rating
        };

        let (black_id, white_id, black_rating, white_rating) = if creator_black {
            (
                creator_id,
                user.id,
                creator_profile.rating,
                joiner_profile.rating,
            )
        } else {
            (
                user.id,
                creator_id,
                joiner_profile.rating,
                creator_profile.rating,
            )
        };
        final_black_id = Some(black_id);
        final_white_id = Some(white_id);

        Some(RatingCalibrationPolicy::default().ranked_settings(black_rating, white_rating))
    } else {
        None
    };

    let mut tx = pool.begin().await?;
    Game::set_opponent(&mut *tx, gwp.game.id, user.id).await?;

    if gwp.game.stage == "unstarted" && gwp.game.ranked {
        let handicap = ranked_settings
            .as_ref()
            .map_or(gwp.game.handicap, |settings| settings.handicap);
        let start_stage = if handicap >= 2 {
            "white_to_play"
        } else {
            "black_to_play"
        };
        Game::set_black(&mut *tx, gwp.game.id, final_black_id.unwrap()).await?;
        Game::set_white(&mut *tx, gwp.game.id, final_white_id.unwrap()).await?;
        Game::set_stage(&mut *tx, gwp.game.id, start_stage).await?;
    } else if gwp.game.stage == "unstarted" {
        let (handicap, komi, color) =
            initial_unrated_pregame_settings(pool, creator_id, user.id).await?;
        PregameSettingsNegotiation::upsert_initial(&mut *tx, gwp.game.id, handicap, komi, &color)
            .await?;
    }

    tx.commit().await?;

    if let (Some(b_id), Some(w_id)) = (final_black_id, final_white_id)
        && let Err(e) =
            rating::capture_ranked_snapshot(pool, gwp.game.id, b_id, w_id, gwp.game.ranked).await
    {
        tracing::warn!(
            game_id = gwp.game.id,
            error = %e,
            "Failed to capture ranked snapshot during game join"
        );
    }

    Ok(())
}

async fn initial_unrated_pregame_settings(
    pool: &DbPool,
    creator_id: i64,
    opponent_id: i64,
) -> Result<(i32, f64, String), AppError> {
    let (creator_profile, opponent_profile) = tokio::try_join!(
        RatingProfile::find(pool, creator_id),
        RatingProfile::find(pool, opponent_id),
    )?;
    let (Some(creator_profile), Some(opponent_profile)) = (creator_profile, opponent_profile)
    else {
        return Ok((0, 6.5, "black".to_string()));
    };

    let settings = RatingCalibrationPolicy::default()
        .ranked_settings(creator_profile.rating, opponent_profile.rating);
    let color = if (creator_profile.rating - opponent_profile.rating).abs() < f64::EPSILON {
        "random".to_string()
    } else if creator_profile.rating < opponent_profile.rating {
        "black".to_string()
    } else {
        "white".to_string()
    };

    Ok((settings.handicap, settings.komi, color))
}
