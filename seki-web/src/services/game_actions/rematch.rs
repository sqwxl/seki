use crate::AppState;
use crate::error::AppError;
use crate::models::game::Game;
use crate::models::user::User;
use crate::services::game_creator::{self, CreateGameParams, RatingRangePreference};
use crate::services::live;

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

    let opponent = if was_black {
        gwp.white.as_ref()
    } else {
        gwp.black.as_ref()
    }
    .ok_or_else(|| AppError::UnprocessableEntity("Opponent not found".to_string()))?;

    let opponent_username = opponent.username.clone();

    let new_id = if gwp.game.ranked {
        ranked_rematch(state, player, &gwp, &opponent_username).await?
    } else {
        unranked_rematch(
            state,
            player,
            &gwp,
            &opponent_username,
            was_black,
            swap_colors,
        )
        .await?
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
    opponent_username: &str,
) -> Result<i64, AppError> {
    let params = CreateGameParams {
        cols: gwp.game.cols,
        rows: gwp.game.rows,
        komi: 6.5,
        handicap: 0,
        is_private: false,
        allow_undo: gwp.game.allow_undo,
        color: "black".to_string(),
        invite_email: None,
        invite_username: Some(opponent_username.to_string()),
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
    Ok(game.id)
}

async fn unranked_rematch(
    state: &AppState,
    player: &User,
    gwp: &crate::models::game::GameWithPlayers,
    opponent_username: &str,
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
        invite_username: Some(opponent_username.to_string()),
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
    Ok(game.id)
}
