use axum::Form;
use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Redirect, Response};
use serde::Deserialize;
use tower_sessions::Session;

use crate::AppState;
use crate::error::AppError;
use crate::models::game::{Game, TimeControlType};
use crate::routes::flash::{FlashMessage, FlashSeverity, set_flash, wants_json};
use crate::services::engine_builder;
use crate::services::game_actions;
use crate::services::game_creator::{self, CreateGameParams, RatingRangePreference};
use crate::services::game_joiner;
use crate::services::state_assembly;
use crate::session::CurrentUser;

#[derive(Deserialize)]
pub struct CreateGameForm {
    pub cols: i32,
    pub komi: Option<f64>,
    pub handicap: Option<i32>,
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
    pub ranked: Option<String>,
    pub rating_range_mode: Option<String>,
    pub max_rating_difference: Option<i32>,
    pub variant: Option<String>,
}

// POST /games
pub async fn create_game(
    State(state): State<AppState>,
    session: Session,
    current_user: CurrentUser,
    headers: axum::http::HeaderMap,
    Form(form): Form<CreateGameForm>,
) -> Result<Response, AppError> {
    let json = wants_json(&headers);

    // TODO: Extract form validation to separate function; order predicates from least to most expensive

    let variant = form.variant.as_deref().unwrap_or("open");
    let invite_username = form
        .invite_username
        .as_deref()
        .map(str::trim)
        .filter(|username| !username.is_empty())
        .map(str::to_string);

    if variant == "challenge" && invite_username.is_none() {
        return create_game_error_response(
            &session,
            json,
            AppError::UnprocessableEntity("Direct challenges require an opponent".to_string()),
        )
        .await;
    }

    let is_ranked = form.ranked.as_deref() == Some("true");
    let is_open = variant == "open";
    let is_email = variant == "email";

    let komi = if is_open || is_ranked {
        6.5
    } else {
        form.komi
            .ok_or_else(|| AppError::UnprocessableEntity("Missing komi".to_string()))?
    };
    let handicap = if is_open || is_ranked {
        0
    } else {
        form.handicap
            .ok_or_else(|| AppError::UnprocessableEntity("Missing handicap".to_string()))?
    };
    if (is_open || is_ranked)
        && (form.komi.is_some() || form.handicap.is_some() || form.color.is_some())
    {
        return Err(AppError::UnprocessableEntity(
            "Ranked and open games derive handicap, komi, and color after an opponent joins"
                .to_string(),
        ));
    }

    let rating_range = if is_open && form.rating_range_mode.as_deref() == Some("absolute") {
        RatingRangePreference::Absolute(form.max_rating_difference.ok_or_else(|| {
            AppError::UnprocessableEntity("Missing max_rating_difference".to_string())
        })?)
    } else if is_open && form.max_rating_difference.is_some() {
        RatingRangePreference::Absolute(form.max_rating_difference.unwrap())
    } else {
        RatingRangePreference::Unlimited
    };

    let color = if is_open || is_ranked {
        "black".to_string()
    } else {
        form.color
            .clone()
            .ok_or_else(|| AppError::UnprocessableEntity("Missing color".to_string()))?
    };

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

    let email_to_send = if is_email {
        form.invite_email.clone()
    } else {
        invite_email.clone()
    };

    let params = CreateGameParams {
        cols,
        rows: cols,
        komi,
        handicap,
        is_private: form.is_private.as_deref() == Some("true"),
        allow_undo: form.allow_undo.as_deref() == Some("true"),
        color,
        invite_email: email_to_send,
        invite_username,
        time_control,
        main_time_secs,
        increment_secs,
        byoyomi_time_secs,
        byoyomi_periods,
        open_to: form.open_to,
        ranked: is_ranked && !is_email,
        rating_range,
        open_game: is_open,
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

        Err(e) => create_game_error_response(&session, json, e).await,
    }
}

async fn create_game_error_response(
    session: &Session,
    json: bool,
    e: AppError,
) -> Result<Response, AppError> {
    if json {
        return Ok((
            StatusCode::UNPROCESSABLE_ENTITY,
            axum::Json(serde_json::json!({ "error": e.to_string() })),
        )
            .into_response());
    }

    set_flash(
        session,
        FlashMessage {
            message: e.to_string(),
            severity: FlashSeverity::Error,
        },
    )
    .await?;

    Ok(Redirect::to("/games/new").into_response())
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

    // TODO: why include here and not at file start?
    use crate::services::game_access;

    game_access::check_join_tokens(
        &gwp,
        query.access_token.as_deref(),
        query.invite_token.as_deref(),
    )?;

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

    let Ok(loaded) = state_assembly::load_game_state(&state, &gwp, &engine, id, false).await else {
        tracing::error!(id, "Failed to load game state after join");
        return Err(AppError::Internal("Failed to load game state".to_string()));
    };

    state
        .registry
        .broadcast(id, &loaded.value.to_string())
        .await;

    // TODO: same question: why not import?
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
    let swap = form.swap_colors.as_deref() == Some("true");
    let new_id = game_actions::rematch_game(&state, &current_user, id, swap).await?;

    let url = format!("/games/{new_id}");
    if json {
        Ok(axum::Json(serde_json::json!({ "redirect": url })).into_response())
    } else {
        Ok(Redirect::to(&url).into_response())
    }
}
