use askama::Template;
use axum::Form;
use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::{Html, IntoResponse, Redirect, Response};
use serde::Deserialize;

use crate::AppState;
use crate::error::AppError;
use crate::models::game::{Game, TimeControlType};
use crate::models::message::Message;
use crate::services::clock::{ClockState, TimeControl};
use crate::services::engine_builder;
use crate::services::game_creator::{self, CreateGameParams};
use crate::services::live::build_live_items;
use crate::services::state_serializer;
use crate::session::CurrentUser;
use crate::templates::UserData;
use crate::templates::games_list::GamesListTemplate;
use crate::templates::games_new::GamesNewTemplate;
use crate::templates::games_show::{GamesShowTemplate, InitialGameProps};

fn serialize_user_data(user: &CurrentUser) -> String {
    serde_json::to_string(&UserData::from(&user.user)).unwrap_or_else(|_| "{}".to_string())
}

// GET /
pub async fn new_game(current_user: CurrentUser) -> Result<Response, AppError> {
    let tmpl = GamesNewTemplate {
        user_username: current_user.username.clone(),
        user_is_registered: current_user.is_registered(),
        user_data: serialize_user_data(&current_user),
        flash: None,
    };
    Ok(Html(
        tmpl.render()
            .map_err(|e| AppError::Internal(e.to_string()))?,
    )
    .into_response())
}

// GET /games
pub async fn list_games(
    State(state): State<AppState>,
    current_user: CurrentUser,
) -> Result<Response, AppError> {
    let (player_games, public_games) = tokio::join!(
        Game::list_for_player(&state.db, current_user.id),
        Game::list_public_with_players(&state.db, Some(current_user.id)),
    );

    let player_games = player_games.unwrap_or_default();
    let public_games = public_games.unwrap_or_default();
    let (player_items, public_items) = tokio::join!(
        build_live_items(&state.db, &player_games),
        build_live_items(&state.db, &public_games),
    );

    let initial_games = serde_json::to_string(&serde_json::json!({
        "player_id": current_user.id,
        "player_games": player_items,
        "public_games": public_items,
    }))
    .unwrap_or_default();

    let tmpl = GamesListTemplate {
        user_username: current_user.username.clone(),
        user_is_registered: current_user.is_registered(),
        user_data: serialize_user_data(&current_user),
        initial_games,
    };

    Ok(Html(
        tmpl.render()
            .map_err(|e| AppError::Internal(e.to_string()))?,
    )
    .into_response())
}

#[derive(Deserialize)]
pub struct CreateGameForm {
    pub cols: Option<i32>,
    pub komi: Option<f64>,
    pub handicap: Option<i32>,
    pub is_private: Option<String>,
    pub allow_undo: Option<String>,
    pub color: Option<String>,
    pub invite_email: Option<String>,
    pub invite_username: Option<String>,
    #[allow(dead_code)]
    pub creator_email: Option<String>,
    pub time_control: Option<String>,
    pub main_time_minutes: Option<i32>,
    pub increment_secs: Option<i32>,
    pub byoyomi_time_secs: Option<i32>,
    pub byoyomi_periods: Option<i32>,
    pub correspondence_days: Option<i32>,
}

// POST /games
pub async fn create_game(
    State(state): State<AppState>,
    current_user: CurrentUser,
    Form(form): Form<CreateGameForm>,
) -> Result<Response, AppError> {
    let cols = form.cols.unwrap_or(19);
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
    let params = CreateGameParams {
        cols,
        rows: cols, // TODO: support non-square boards?
        komi: form.komi.unwrap_or(0.5),
        handicap: form.handicap.unwrap_or(0),
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
    };

    match game_creator::create_game(&state.db, &current_user, params).await {
        Ok(game) => {
            crate::services::live::notify_game_created(&state, game.id).await;
            Ok(Redirect::to(&format!("/games/{}", game.id)).into_response())
        }
        Err(e) => {
            let tmpl = GamesNewTemplate {
                user_username: current_user.username.clone(),
                user_is_registered: current_user.is_registered(),
                user_data: serialize_user_data(&current_user),
                flash: Some(e.to_string()),
            };
            Ok((
                StatusCode::UNPROCESSABLE_ENTITY,
                Html(
                    tmpl.render()
                        .map_err(|e| AppError::Internal(e.to_string()))?,
                ),
            )
                .into_response())
        }
    }
}

// GET /games/:id
pub async fn show_game(
    State(state): State<AppState>,
    current_user: CurrentUser,
    Path(id): Path<i64>,
) -> Result<Response, AppError> {
    let gwp = Game::find_with_players(&state.db, id).await?;

    // Build chat log JSON
    let messages = Message::find_by_game_id_with_sender(&state.db, id).await?;
    let chat_log: Vec<serde_json::Value> = messages
        .iter()
        .map(|msg| {
            serde_json::json!({
                "user_id": msg.user_id,
                "display_name": msg.display_name,
                "text": msg.text,
                "move_number": msg.move_number,
                "sent_at": msg.created_at
            })
        })
        .collect();
    let chat_log_json = serde_json::to_string(&chat_log).unwrap_or_else(|_| "[]".to_string());

    let is_creator = gwp.game.creator_id == Some(current_user.id);
    let has_open_slot = gwp.black.is_none() || gwp.white.is_none();

    let engine = state
        .registry
        .get_or_init_engine(&state.db, &gwp.game)
        .await?;

    // The engine derives stage from moves, but the DB is authoritative for
    // terminal states, challenges, and games that started but have no moves yet.
    let stage = if gwp.game.result.is_some() {
        gwp.game.stage.clone()
    } else if gwp.game.stage == "challenge" {
        "challenge".to_string()
    } else if engine.stage() == go_engine::Stage::Unstarted
        && gwp.game.stage != "unstarted"
        && gwp.game.stage != "challenge"
    {
        // DB says game started but engine has no moves yet
        if gwp.game.handicap >= 2 {
            "white_to_play".to_string()
        } else {
            "black_to_play".to_string()
        }
    } else {
        engine.stage().to_string()
    };

    // Load settled territory for finished games
    let settled_territory = if gwp.game.result.is_some() {
        Game::load_settled_territory(&state.db, id)
            .await
            .ok()
            .flatten()
            .map(|raw| state_serializer::build_settled_territory(&engine, gwp.game.komi, raw))
    } else {
        None
    };

    let game_props = serde_json::to_string(&InitialGameProps {
        state: engine.game_state(),
        creator_id: gwp.game.creator_id,
        black: gwp.black.as_ref().map(UserData::from),
        white: gwp.white.as_ref().map(UserData::from),
        komi: gwp.game.komi,
        stage: stage.clone(),
        settings: crate::services::live::GameSettings {
            cols: gwp.game.cols,
            rows: gwp.game.rows,
            handicap: engine_builder::game_handicap(&gwp.game) as i32,
            time_control: gwp.game.time_control,
            main_time_secs: gwp.game.main_time_secs,
            increment_secs: gwp.game.increment_secs,
            byoyomi_time_secs: gwp.game.byoyomi_time_secs,
            byoyomi_periods: gwp.game.byoyomi_periods,
            is_private: gwp.game.is_private,
        },
        moves: engine.moves().to_vec(),
        current_turn_stone: engine.current_turn_stone().to_int() as i32,
        result: gwp.game.result.clone(),
        settled_territory,
        invite_token: if is_creator {
            gwp.game.invite_token.clone()
        } else {
            None
        },
    })
    .unwrap();

    let black_name = gwp
        .black
        .as_ref()
        .map(|u| u.username.as_str())
        .unwrap_or("Black");
    let white_name = gwp
        .white
        .as_ref()
        .map(|u| u.username.as_str())
        .unwrap_or("White");
    let board_size = format!("{}×{}", gwp.game.cols, gwp.game.rows);
    let og_title = format!("{black_name} vs {white_name} — {board_size}");
    let og_description = if has_open_slot {
        format!("Join this {board_size} Go game on Seki")
    } else {
        format!("Watch this {board_size} Go game on Seki")
    };

    let tmpl = GamesShowTemplate {
        user_username: current_user.username.clone(),
        user_is_registered: current_user.is_registered(),
        user_data: serialize_user_data(&current_user),
        game_id: gwp.game.id,
        game_props,
        chat_log_json,
        og_title,
        og_description,
    };

    Ok(Html(
        tmpl.render()
            .map_err(|e| AppError::Internal(e.to_string()))?,
    )
    .into_response())
}

// POST /games/:id/join
pub async fn join_game(
    State(state): State<AppState>,
    current_user: CurrentUser,
    Path(id): Path<i64>,
) -> Result<Response, AppError> {
    let gwp = Game::find_with_players(&state.db, id).await?;

    if gwp.has_player(current_user.id) {
        return Ok(Redirect::to(&format!("/games/{id}")).into_response());
    }

    let mut tx = state.db.begin().await?;
    if gwp.black.is_none() {
        Game::set_black(&mut *tx, id, current_user.id).await?;
    } else if gwp.white.is_none() {
        Game::set_white(&mut *tx, id, current_user.id).await?;
    } else {
        return Err(AppError::BadRequest("Game is full".to_string()));
    }
    let started = gwp.game.stage == "unstarted";
    let start_stage = if gwp.game.handicap >= 2 {
        "white_to_play"
    } else {
        "black_to_play"
    };
    if started {
        Game::set_stage(&mut *tx, id, start_stage).await?;
    }
    tx.commit().await?;

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

    let online_ids = state.registry.get_online_user_ids(id).await;
    let online_users: Vec<UserData> =
        crate::models::user::User::find_by_ids(&state.db, &online_ids)
            .await
            .unwrap_or_default()
            .iter()
            .map(UserData::from)
            .collect();
    let game_state = state_serializer::serialize_state(
        &gwp,
        &engine,
        false,
        None,
        None,
        clock_ref,
        &online_users,
    );
    state.registry.broadcast(id, &game_state.to_string()).await;

    crate::services::live::notify_game_created(&state, id).await;

    Ok(Redirect::to(&format!("/games/{id}")).into_response())
}

#[derive(Deserialize)]
pub struct RematchForm {
    pub swap_colors: Option<String>,
}

#[derive(Deserialize)]
pub struct InvitationQuery {
    pub token: String,
    pub email: String,
}

// GET /games/:id/invitation
pub async fn invitation(
    State(state): State<AppState>,
    current_user: CurrentUser,
    Path(id): Path<i64>,
    Query(query): Query<InvitationQuery>,
) -> Result<Response, AppError> {
    let gwp = Game::find_with_players(&state.db, id).await?;

    // If current user is already in the game, redirect
    if gwp.has_player(current_user.id) {
        return Ok(Redirect::to(&format!("/games/{id}")).into_response());
    }

    // Verify token
    let game_token = gwp.game.invite_token.as_deref().unwrap_or("");
    if game_token != query.token {
        return Err(AppError::BadRequest("Invalid invitation token".to_string()));
    }

    // Check game not full
    if gwp.black.is_some() && gwp.white.is_some() {
        return Err(AppError::BadRequest("Game is already full".to_string()));
    }

    // Find the invited user by email
    let guest = crate::models::user::User::find_by_email(&state.db, &query.email)
        .await?
        .ok_or_else(|| AppError::NotFound("User not found".to_string()))?;

    // Add guest to game
    let mut tx = state.db.begin().await?;
    if gwp.black.is_none() {
        Game::set_black(&mut *tx, id, guest.id).await?;
    } else if gwp.white.is_none() {
        Game::set_white(&mut *tx, id, guest.id).await?;
    }
    if gwp.game.stage == "unstarted" {
        Game::set_stage(&mut *tx, id, "challenge").await?;
    }
    tx.commit().await?;

    Ok(Redirect::to(&format!("/games/{id}")).into_response())
}

// POST /games/:id/rematch
pub async fn rematch_game(
    State(state): State<AppState>,
    current_user: CurrentUser,
    Path(id): Path<i64>,
    Form(form): Form<RematchForm>,
) -> Result<Response, AppError> {
    let gwp = Game::find_with_players(&state.db, id).await?;

    if gwp.game.result.is_none() {
        return Err(AppError::BadRequest("Game is not finished".to_string()));
    }
    if !gwp.has_player(current_user.id) {
        return Err(AppError::BadRequest(
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

    crate::services::live::notify_game_created(&state, game.id).await;
    Ok(Redirect::to(&format!("/games/{}", game.id)).into_response())
}
