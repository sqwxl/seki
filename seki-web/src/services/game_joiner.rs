use rand::RngExt;

use crate::db::DbPool;
use crate::error::AppError;
use crate::models::game::Game;
use crate::models::game::GameWithPlayers;
use crate::models::pregame_settings::PregameSettingsNegotiation;
use crate::models::rating::RatingProfile;
use crate::models::user::User;
use crate::services::rating::{self, RatingCalibrationPolicy};

// TODO: Function is too big, refactor
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
            "This game is restricted to registered users only. Register an account to join this game."
                .to_string(),
        ));
    }

    let Some(creator_id) = gwp.game.creator_id else {
        return Err(AppError::UnprocessableEntity(
            "Open games require a creator".to_string(),
        ));
    };

    if gwp.game.opponent_id.is_some() {
        return Err(AppError::UnprocessableEntity(
            "This game is full".to_string(),
        ));
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
            "Your rank is outside the allowed rating range for this game.".to_string(),
        ));
    }

    let mut final_black_id = None;
    let mut final_white_id = None;
    let ranked_settings = if gwp.game.ranked {
        if !gwp.game.rating_difference_lower_unlimited
            || !gwp.game.rating_difference_higher_unlimited
        {
            let creator_profile = RatingProfile::find(pool, creator_id).await?;

            let Some(creator_profile) = creator_profile.as_ref() else {
                return Err(AppError::UnprocessableEntity(
                    "Ranked games require player ratings".to_string(),
                ));
            };

            let Some(joiner_profile) = joiner_profile.as_ref() else {
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
                    "Your rank is outside the allowed rating range for this game.".to_string(),
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
        // Custom-settings open games keep the creator's choices;
        // otherwise derive handicap/komi/color from both players' ratings.
        let (handicap, komi, color) = match gwp.game.creator_color.as_deref() {
            Some(color) => (gwp.game.handicap, gwp.game.komi, color.to_string()),
            None => initial_unrated_pregame_settings(pool, creator_id, user.id).await?,
        };
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

#[cfg(test)]
mod tests {
    use chrono::Utc;

    use super::join_open_game;
    use crate::models::game::{Game, TimeControlType};
    use crate::models::pregame_settings::PregameSettingsNegotiation;
    use crate::models::user::User;

    async fn test_pool() -> crate::db::DbPool {
        let path = std::env::temp_dir().join(format!(
            "seki-joiner-test-{}-{}.db",
            std::process::id(),
            Utc::now().timestamp_nanos_opt().unwrap()
        ));
        let url = format!("sqlite://{}", path.display());
        let pool = crate::db::create_pool(&url).await.unwrap();
        crate::db::run_migrations(&pool).await.unwrap();
        pool
    }

    async fn create_open_game(
        pool: &crate::db::DbPool,
        creator_id: i64,
        creator_color: Option<&str>,
    ) -> Game {
        Game::create(
            pool,
            creator_id,
            None,
            None,
            None,
            9,
            9,
            0.5,
            3,
            false,
            false,
            "access-token",
            None,
            TimeControlType::None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            creator_color.is_some(),
            creator_color,
            None,
            false,
            false,
            "unlimited",
            None,
            None,
            true,
            true,
        )
        .await
        .unwrap()
    }

    #[tokio::test]
    async fn custom_settings_open_game_uses_creator_choices_at_join() {
        let pool = test_pool().await;
        let creator = User::create(&pool).await.unwrap();
        let joiner = User::create(&pool).await.unwrap();

        let game = create_open_game(&pool, creator.id, Some("white")).await;
        let gwp = Game::find_with_players(&pool, game.id).await.unwrap();

        join_open_game(&pool, &gwp, &joiner).await.unwrap();

        let settings = PregameSettingsNegotiation::find(&pool, game.id)
            .await
            .unwrap()
            .expect("pregame settings proposal should exist");

        assert_eq!(settings.handicap, 3);
        assert_eq!(settings.komi, 0.5);
        assert_eq!(settings.color, "white");
    }

    #[tokio::test]
    async fn rank_based_open_game_derives_even_defaults_without_ratings() {
        let pool = test_pool().await;
        let creator = User::create(&pool).await.unwrap();
        let joiner = User::create(&pool).await.unwrap();

        let game = create_open_game(&pool, creator.id, None).await;
        let gwp = Game::find_with_players(&pool, game.id).await.unwrap();

        join_open_game(&pool, &gwp, &joiner).await.unwrap();

        let settings = PregameSettingsNegotiation::find(&pool, game.id)
            .await
            .unwrap()
            .expect("pregame settings proposal should exist");

        // Neither player has a rating profile -> neutral even-game defaults.
        assert_eq!(settings.handicap, 0);
        assert_eq!(settings.komi, 6.5);
        assert_eq!(settings.color, "black");
    }
}
