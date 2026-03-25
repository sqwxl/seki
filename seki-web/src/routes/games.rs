use axum::Form;
use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Redirect, Response};
use serde::Deserialize;

use crate::AppState;
use crate::error::AppError;
use crate::models::game::{Game, TimeControlType};
use crate::routes::{FlashMessage, FlashSeverity, flash_redirect, wants_json};
use crate::services::clock::{ClockState, TimeControl};
use crate::services::engine_builder;
use crate::services::game_creator::{self, CreateGameParams};
use crate::services::game_joiner;
use crate::services::state_serializer;
use crate::session::CurrentUser;

#[derive(Deserialize)]
pub struct CreateGameForm {
    pub cols: i32,
    pub komi: f64,
    pub handicap: i32,
    pub is_private: Option<String>,
    pub allow_undo: Option<String>,
    pub color: Option<String>,
    pub invite_email: Option<String>,
    pub invite_username: Option<String>,
    pub time_control: Option<String>,
    pub main_time_minutes: Option<i32>,
    pub increment_secs: Option<i32>,
    pub byoyomi_time_secs: Option<i32>,
    pub byoyomi_periods: Option<i32>,
    pub correspondence_days: Option<i32>,
    pub open_to: Option<String>,
}

// POST /games
pub async fn create_game(
    State(state): State<AppState>,
    current_user: CurrentUser,
    headers: axum::http::HeaderMap,
    Form(form): Form<CreateGameForm>,
) -> Result<Response, AppError> {
    let json = wants_json(&headers);
    let cols = form.cols;
    let time_control = match form.time_control.as_deref() {
        Some("fischer") => TimeControlType::Fischer,
        Some("byoyomi") => TimeControlType::Byoyomi,
        Some("correspondence") => TimeControlType::Correspondence,
        _ => TimeControlType::None,
    };
    let (main_time_secs, increment_secs, byoyomi_time_secs, byoyomi_periods) = match time_control {
        TimeControlType::Fischer => (
            form.main_time_minutes.map(|m| m * 60),
            form.increment_secs,
            None,
            None,
        ),
        TimeControlType::Byoyomi => (
            form.main_time_minutes.map(|m| m * 60),
            None,
            form.byoyomi_time_secs,
            form.byoyomi_periods,
        ),
        TimeControlType::Correspondence => (
            form.correspondence_days.map(|d| d * 86400),
            None,
            None,
            None,
        ),
        TimeControlType::None => (None, None, None, None),
    };
    let invite_email = form.invite_email.clone();
    let params = CreateGameParams {
        cols,
        rows: cols, // TODO: support non-square boards?
        komi: form.komi,
        handicap: form.handicap,
        is_private: form.is_private.as_deref() == Some("true"),
        allow_undo: form.allow_undo.as_deref() == Some("true"),
        color: form.color.unwrap_or_else(|| "black".to_string()),
        invite_email: form.invite_email,
        invite_username: form.invite_username,
        time_control,
        main_time_secs,
        increment_secs,
        byoyomi_time_secs,
        byoyomi_periods,
        open_to: form.open_to,
    };

    match game_creator::create_game(&state.db, &current_user, params).await {
        Ok(game) => {
            if let Ok(gwp) = Game::find_with_players(&state.db, game.id).await {
                crate::services::live::notify_game_created(&state, &gwp);
            }
            if let (Some(email), Some(token)) = (&invite_email, &game.invite_token) {
                let mailer = state.mailer.clone();
                let email = email.clone();
                let token = token.clone();
                let base_url =
                    std::env::var("BASE_URL").unwrap_or_else(|_| "http://localhost:3000".into());
                let game_id = game.id;
                tokio::spawn(async move {
                    mailer
                        .send_invitation(&email, game_id, &token, &base_url)
                        .await;
                });
            }
            let url = format!("/games/{}", game.id);
            if json {
                Ok(axum::Json(serde_json::json!({ "redirect": url })).into_response())
            } else {
                Ok(Redirect::to(&url).into_response())
            }
        }
        Err(e) => {
            if json {
                return Ok((
                    StatusCode::UNPROCESSABLE_ENTITY,
                    axum::Json(serde_json::json!({ "error": e.to_string() })),
                )
                    .into_response());
            }
            let url = flash_redirect(
                "/games/new",
                FlashMessage {
                    message: e.to_string(),
                    severity: FlashSeverity::Error,
                },
            )?;
            Ok(Redirect::to(&url).into_response())
        }
    }
}

#[derive(Deserialize)]
pub struct ShowGameQuery {
    pub access_token: Option<String>,
    pub invite_token: Option<String>,
}

// POST /games/:id/join
pub async fn join_game(
    State(state): State<AppState>,
    current_user: CurrentUser,
    headers: axum::http::HeaderMap,
    Path(id): Path<i64>,
    Query(query): Query<ShowGameQuery>,
) -> Result<Response, AppError> {
    let json = wants_json(&headers);
    let gwp = Game::find_with_players(&state.db, id).await?;

    if gwp.has_player(current_user.id) {
        let url = format!("/games/{id}");
        if json {
            return Ok(axum::Json(serde_json::json!({ "redirect": url })).into_response());
        }
        return Ok(Redirect::to(&url).into_response());
    }

    let has_valid_access_token = gwp
        .game
        .access_token
        .as_deref()
        .zip(query.access_token.as_deref())
        .is_some_and(|(game_tok, query_tok)| game_tok == query_tok);
    let has_valid_invite_token = gwp
        .game
        .invite_token
        .as_deref()
        .zip(query.invite_token.as_deref())
        .is_some_and(|(game_tok, query_tok)| game_tok == query_tok);

    if gwp.game.requires_access_token_to_join() && !has_valid_access_token {
        return Err(AppError::UnprocessableEntity(
            "This game requires a valid access token to join".to_string(),
        ));
    }

    if gwp.game.requires_invite_token_to_join() && !has_valid_invite_token {
        return Err(AppError::UnprocessableEntity(
            "This game requires a valid invite token to join".to_string(),
        ));
    }

    if gwp.game.open_to.as_deref() == Some("registered") && !current_user.is_registered() {
        return Err(AppError::UnprocessableEntity(
            "This game is restricted to registered users".to_string(),
        ));
    }

    game_joiner::join_open_game(&state.db, &gwp, &current_user.user).await?;

    // Notify existing WS clients about the new user
    let game = Game::find_by_id(&state.db, id).await?;
    let engine = engine_builder::build_engine(&state.db, &game).await?;
    let gwp = Game::find_with_players(&state.db, id).await?;

    let tc = TimeControl::from_game(&gwp.game);
    let clock_data = if !tc.is_none() {
        ClockState::from_game(&gwp.game).map(|c| (c, tc))
    } else {
        None
    };
    let clock_ref = clock_data.as_ref().map(|(c, tc)| (c, tc));

    let game_state = state_serializer::serialize_state(&gwp, &engine, false, None, None, clock_ref);
    state.registry.broadcast(id, &game_state.to_string()).await;

    crate::services::live::notify_game_created(&state, &gwp);

    let access_q = query
        .access_token
        .as_deref()
        .map(|token| format!("?access_token={token}"));
    let url = format!("/games/{id}{}", access_q.unwrap_or_default());
    if json {
        Ok(axum::Json(serde_json::json!({ "redirect": url })).into_response())
    } else {
        Ok(Redirect::to(&url).into_response())
    }
}

#[derive(Deserialize)]
pub struct RematchForm {
    pub swap_colors: Option<String>,
}

// POST /games/:id/rematch
pub async fn rematch_game(
    State(state): State<AppState>,
    current_user: CurrentUser,
    headers: axum::http::HeaderMap,
    Path(id): Path<i64>,
    Form(form): Form<RematchForm>,
) -> Result<Response, AppError> {
    let json = wants_json(&headers);
    let gwp = Game::find_with_players(&state.db, id).await?;

    if gwp.game.result.is_none() {
        return Err(AppError::UnprocessableEntity(
            "Game is not finished".to_string(),
        ));
    }
    if !gwp.has_player(current_user.id) {
        return Err(AppError::UnprocessableEntity(
            "You are not a player in this game".to_string(),
        ));
    }

    let swap = form.swap_colors.as_deref() == Some("true");
    let was_black = gwp.game.black_id == Some(current_user.id);
    let color = match (was_black, swap) {
        (true, false) | (false, true) => "black",
        (true, true) | (false, false) => "white",
    };

    let opponent_id = if was_black {
        gwp.game.white_id
    } else {
        gwp.game.black_id
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
    };

    let game = game_creator::create_game(&state.db, &current_user, params).await?;

    if let Some(opp_id) = opponent_id {
        let mut tx = state.db.begin().await?;
        if game.black_id.is_none() {
            Game::set_black(&mut *tx, game.id, opp_id).await?;
        } else if game.white_id.is_none() {
            Game::set_white(&mut *tx, game.id, opp_id).await?;
        }
        if game.stage == "unstarted" {
            Game::set_stage(&mut *tx, game.id, "challenge").await?;
        }
        tx.commit().await?;
    }

    if let Ok(gwp) = Game::find_with_players(&state.db, game.id).await {
        crate::services::live::notify_game_created(&state, &gwp);
    }
    let url = format!("/games/{}", game.id);
    if json {
        Ok(axum::Json(serde_json::json!({ "redirect": url })).into_response())
    } else {
        Ok(Redirect::to(&url).into_response())
    }
}
