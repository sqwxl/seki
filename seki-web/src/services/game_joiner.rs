use rand::RngExt;

use crate::db::DbPool;
use crate::error::AppError;
use crate::models::game::Game;
use crate::models::game::GameWithPlayers;
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

    if gwp.game.ranked {
        let profile = RatingProfile::find(pool, user.id).await?;
        rating::can_join_ranked(user, profile.as_ref())?;
    }

    if gwp.game.open_to.as_deref() == Some("registered") && !user.is_registered() {
        return Err(AppError::UnprocessableEntity(
            "This game is restricted to registered users".to_string(),
        ));
    }

    let joining_black = gwp.black.is_none();
    let joining_white = !joining_black && gwp.white.is_none();
    let mut black_after_join = if joining_black {
        Some(user.id)
    } else {
        gwp.game.black_id
    };
    let mut white_after_join = if joining_white {
        Some(user.id)
    } else {
        gwp.game.white_id
    };

    let mut swap_for_ranked = false;
    let ranked_settings = if gwp.game.ranked {
        let (black_id, white_id) = match (black_after_join, white_after_join) {
            (Some(black_id), Some(white_id)) => (black_id, white_id),
            _ => {
                return Err(AppError::UnprocessableEntity(
                    "Ranked games require two players".to_string(),
                ));
            }
        };
        let mut black_profile = RatingProfile::get_or_create(pool, black_id).await?;
        let mut white_profile = RatingProfile::get_or_create(pool, white_id).await?;
        let should_swap = if (black_profile.rating - white_profile.rating).abs() < f64::EPSILON {
            rand::rng().random_bool(0.5)
        } else {
            black_profile.rating > white_profile.rating
        };

        if should_swap {
            swap_for_ranked = true;
            std::mem::swap(&mut black_after_join, &mut white_after_join);
            std::mem::swap(&mut black_profile, &mut white_profile);
        }

        Some(
            RatingCalibrationPolicy::default()
                .ranked_settings(black_profile.rating, white_profile.rating),
        )
    } else {
        None
    };

    let mut tx = pool.begin().await?;
    if joining_black {
        Game::set_black(&mut *tx, gwp.game.id, user.id).await?;
    } else if joining_white {
        Game::set_white(&mut *tx, gwp.game.id, user.id).await?;
    } else {
        return Err(AppError::UnprocessableEntity("Game is full".to_string()));
    }

    if swap_for_ranked || (!gwp.game.ranked && gwp.game.nigiri && rand::rng().random_bool(0.5)) {
        Game::swap_players(&mut *tx, gwp.game.id).await?;
    }

    if gwp.game.stage == "unstarted" {
        let handicap = ranked_settings
            .as_ref()
            .map_or(gwp.game.handicap, |settings| settings.handicap);
        let start_stage = if handicap >= 2 {
            "white_to_play"
        } else {
            "black_to_play"
        };
        Game::set_stage(&mut *tx, gwp.game.id, start_stage).await?;
    }

    tx.commit().await?;

    if let (Some(b_id), Some(w_id)) = (black_after_join, white_after_join)
        && let Err(e) = rating::capture_ranked_snapshot(
            pool,
            gwp.game.id,
            b_id,
            w_id,
            gwp.game.max_handicap,
            gwp.game.ranked,
        )
        .await
    {
        tracing::warn!(
            game_id = gwp.game.id,
            error = %e,
            "Failed to capture ranked snapshot during game join"
        );
    }

    Ok(())
}
