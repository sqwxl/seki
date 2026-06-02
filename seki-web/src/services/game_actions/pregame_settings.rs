use rand::RngExt;

use crate::AppState;
use crate::error::AppError;
use crate::models::game::Game;
use crate::models::pregame_settings::PregameSettingsNegotiation;
use crate::services::engine_builder;

use super::{broadcast_game_state, load_game_and_check_player, require_both_players};

pub async fn update_pregame_settings(
    state: &AppState,
    game_id: i64,
    player_id: i64,
    handicap: i32,
    komi: f64,
    color: String,
) -> Result<(), AppError> {
    let gwp = load_game_and_check_player(state, game_id, player_id).await?;
    require_pregame_settings(&gwp)?;
    validate_settings(&gwp.game, handicap, komi, &color)?;

    PregameSettingsNegotiation::update_proposal(&state.db, game_id, handicap, komi, &color).await?;

    let engine = state
        .registry
        .get_or_init_engine(&state.db, &gwp.game)
        .await?;
    broadcast_game_state(state, &gwp, &engine).await;
    Ok(())
}

pub async fn accept_pregame_settings(
    state: &AppState,
    game_id: i64,
    player_id: i64,
) -> Result<(), AppError> {
    let gwp = load_game_and_check_player(state, game_id, player_id).await?;

    require_pregame_settings(&gwp)?;

    let role = participant_role(&gwp, player_id)?;

    let mut negotiation = PregameSettingsNegotiation::find(&state.db, game_id)
        .await?
        .ok_or_else(|| {
            AppError::UnprocessableEntity("No pre-game settings to accept".to_string())
        })?;

    match role {
        ParticipantRole::Creator => negotiation.creator_approved = true,
        ParticipantRole::Opponent => negotiation.opponent_approved = true,
    }

    if negotiation.creator_approved && negotiation.opponent_approved {
        finalize_pregame_settings(state, gwp, negotiation).await?;
        return Ok(());
    }

    PregameSettingsNegotiation::set_approved(
        &state.db,
        game_id,
        negotiation.creator_approved,
        negotiation.opponent_approved,
        None,
    )
    .await?;

    let engine = state
        .registry
        .get_or_init_engine(&state.db, &gwp.game)
        .await?;
    broadcast_game_state(state, &gwp, &engine).await;
    Ok(())
}

pub async fn reject_pregame_settings(
    state: &AppState,
    game_id: i64,
    player_id: i64,
) -> Result<(), AppError> {
    let gwp = load_game_and_check_player(state, game_id, player_id).await?;

    require_pregame_settings(&gwp)?;

    let mut tx = state.db.begin().await?;

    PregameSettingsNegotiation::delete(&mut *tx, game_id).await?;

    Game::clear_opponent(&mut *tx, game_id).await?;

    tx.commit().await?;

    let updated = Game::find_with_players(&state.db, game_id).await?;
    let engine = state
        .registry
        .get_or_init_engine(&state.db, &updated.game)
        .await?;
    broadcast_game_state(state, &updated, &engine).await;
    Ok(())
}

async fn finalize_pregame_settings(
    state: &AppState,
    gwp: crate::models::game::GameWithPlayers,
    negotiation: PregameSettingsNegotiation,
) -> Result<(), AppError> {
    validate_settings(
        &gwp.game,
        negotiation.handicap,
        negotiation.komi,
        &negotiation.color,
    )?;
    let (black_id, white_id) = final_player_assignment(&gwp, &negotiation.color)?;
    let stage = if negotiation.handicap >= 2 {
        "white_to_play"
    } else {
        "black_to_play"
    };

    let mut tx = state.db.begin().await?;
    Game::update_rules(
        &mut *tx,
        gwp.game.id,
        negotiation.handicap,
        negotiation.komi,
        black_id,
        white_id,
        stage,
    )
    .await?;
    PregameSettingsNegotiation::delete(&mut *tx, gwp.game.id).await?;
    tx.commit().await?;

    let updated = Game::find_with_players(&state.db, gwp.game.id).await?;
    if let (Some(b_id), Some(w_id)) = (black_id, white_id)
        && let Err(e) = crate::services::rating::capture_ranked_snapshot(
            &state.db,
            gwp.game.id,
            b_id,
            w_id,
            updated.game.ranked,
        )
        .await
    {
        tracing::warn!(
            game_id = gwp.game.id,
            error = %e,
            "Failed to capture rating snapshot during pre-game finalization"
        );
    }

    let engine = engine_builder::build_engine(&state.db, &updated.game).await?;
    state
        .registry
        .replace_engine(gwp.game.id, engine.clone())
        .await;
    broadcast_game_state(state, &updated, &engine).await;
    Ok(())
}

fn require_pregame_settings(gwp: &crate::models::game::GameWithPlayers) -> Result<(), AppError> {
    require_both_players(gwp)?;
    if gwp.game.ranked || gwp.game.stage != "unstarted" {
        return Err(AppError::UnprocessableEntity(
            "Game is not negotiating pre-game settings".to_string(),
        ));
    }
    Ok(())
}

enum ParticipantRole {
    Creator,
    Opponent,
}

fn participant_role(
    gwp: &crate::models::game::GameWithPlayers,
    player_id: i64,
) -> Result<ParticipantRole, AppError> {
    if gwp.game.creator_id == Some(player_id) {
        Ok(ParticipantRole::Creator)
    } else if gwp.game.opponent_id == Some(player_id) {
        Ok(ParticipantRole::Opponent)
    } else {
        Err(AppError::UnprocessableEntity(
            "You are not a user in this game".to_string(),
        ))
    }
}

fn validate_settings(game: &Game, handicap: i32, komi: f64, color: &str) -> Result<(), AppError> {
    if !matches!(color, "black" | "white" | "random") {
        return Err(AppError::UnprocessableEntity("Invalid color".to_string()));
    }
    if komi.fract().abs() != 0.5 {
        return Err(AppError::UnprocessableEntity(
            "Komi must be a half-integer (e.g. 0.5, 6.5, -3.5)".to_string(),
        ));
    }
    if handicap < 0 {
        return Err(AppError::UnprocessableEntity(
            "Handicap cannot be negative".to_string(),
        ));
    }
    let max_hc = go_engine::handicap::max_handicap(game.cols as u8, game.rows as u8);
    if handicap > 0 && max_hc == 0 {
        return Err(AppError::UnprocessableEntity(
            "Handicap is not supported for this board size".to_string(),
        ));
    }
    if handicap > max_hc as i32 {
        return Err(AppError::UnprocessableEntity(format!(
            "Maximum handicap for {}x{} board is {}",
            game.cols, game.rows, max_hc
        )));
    }
    Ok(())
}

fn final_player_assignment(
    gwp: &crate::models::game::GameWithPlayers,
    color: &str,
) -> Result<(Option<i64>, Option<i64>), AppError> {
    let creator_id = gwp
        .game
        .creator_id
        .ok_or_else(|| AppError::UnprocessableEntity("Game has no creator".to_string()))?;
    let opponent_id = gwp
        .opponent_of(creator_id)
        .map(|user| user.id)
        .ok_or_else(|| AppError::UnprocessableEntity("Game has no opponent".to_string()))?;

    let creator_black = match color {
        "black" => true,
        "white" => false,
        "random" => rand::rng().random_bool(0.5),
        _ => true,
    };

    if creator_black {
        Ok((Some(creator_id), Some(opponent_id)))
    } else {
        Ok((Some(opponent_id), Some(creator_id)))
    }
}
