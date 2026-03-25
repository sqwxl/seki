use rand::RngExt;

use crate::db::DbPool;
use crate::error::AppError;
use crate::models::game::Game;
use crate::models::game::GameWithPlayers;
use crate::models::user::User;

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

    if gwp.game.open_to.as_deref() == Some("registered") && !user.is_registered() {
        return Err(AppError::UnprocessableEntity(
            "This game is restricted to registered users".to_string(),
        ));
    }

    let mut tx = pool.begin().await?;
    if gwp.black.is_none() {
        Game::set_black(&mut *tx, gwp.game.id, user.id).await?;
    } else if gwp.white.is_none() {
        Game::set_white(&mut *tx, gwp.game.id, user.id).await?;
    } else {
        return Err(AppError::UnprocessableEntity("Game is full".to_string()));
    }

    if gwp.game.nigiri && rand::rng().random_bool(0.5) {
        Game::swap_players(&mut *tx, gwp.game.id).await?;
    }

    if gwp.game.stage == "unstarted" {
        let start_stage = if gwp.game.handicap >= 2 {
            "white_to_play"
        } else {
            "black_to_play"
        };
        Game::set_stage(&mut *tx, gwp.game.id, start_stage).await?;
    }

    tx.commit().await?;
    Ok(())
}
