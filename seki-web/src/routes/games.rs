use askama::Template;
use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::{Html, IntoResponse, Redirect, Response};
use axum::Form;
use serde::Deserialize;

use crate::error::AppError;
use crate::models::game::Game;
use crate::models::message::Message;
use crate::services::engine_builder;
use crate::services::game_actions;
use crate::services::game_creator::{self, CreateGameParams};
use crate::services::state_serializer;
use crate::session::CurrentPlayer;
use crate::templates::games_list::GamesListTemplate;
use crate::templates::games_new::GamesNewTemplate;
use crate::templates::games_show::{GamesShowTemplate, InitialGameProps};
use crate::templates::PlayerData;
use crate::AppState;

fn serialize_player_data(player: &CurrentPlayer) -> String {
    serde_json::to_string(&PlayerData::from(&player.player)).unwrap_or_else(|_| "{}".to_string())
}

// GET /
pub async fn new_game(current_player: CurrentPlayer) -> Result<Response, AppError> {
    let tmpl = GamesNewTemplate {
        player_username: current_player.username.clone(),
        player_is_registered: current_player.is_registered(),
        player_data: serialize_player_data(&current_player),
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
    current_player: CurrentPlayer,
) -> Result<Response, AppError> {
    let tmpl = GamesListTemplate {
        player_username: current_player.username.clone(),
        player_is_registered: current_player.is_registered(),
        player_data: serialize_player_data(&current_player),
        player_games: Game::list_for_player(&state.db, current_player.id).await?,
        public_games: Game::list_public_with_players(&state.db, Some(current_player.id)).await?,
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
    pub is_handicap: Option<String>,
    pub color: Option<String>,
    pub invite_email: Option<String>,
    #[allow(dead_code)]
    pub creator_email: Option<String>,
}

// POST /games
pub async fn create_game(
    State(state): State<AppState>,
    current_player: CurrentPlayer,
    Form(form): Form<CreateGameForm>,
) -> Result<Response, AppError> {
    let cols = form.cols.unwrap_or(19);
    let params = CreateGameParams {
        cols,
        rows: cols, // TODO: support non-square boards?
        komi: form.komi.unwrap_or(0.5),
        handicap: form.handicap.unwrap_or(2),
        is_private: form.is_private.as_deref() == Some("true"),
        is_handicap: form.is_handicap.as_deref() == Some("true"),
        color: form.color.unwrap_or_else(|| "black".to_string()),
        invite_email: form.invite_email,
    };

    match game_creator::create_game(&state.db, &current_player, params).await {
        Ok(game) => Ok(Redirect::to(&format!("/games/{}", game.id)).into_response()),
        Err(e) => {
            let tmpl = GamesNewTemplate {
                player_username: current_player.username.clone(),
                player_is_registered: current_player.is_registered(),
                player_data: serialize_player_data(&current_player),
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
    current_player: CurrentPlayer,
    Path(id): Path<i64>,
) -> Result<Response, AppError> {
    let gwp = Game::find_with_players(&state.db, id).await?;

    // Build chat log JSON
    let messages = Message::find_by_game_id(&state.db, id).await?;
    let chat_log: Vec<serde_json::Value> = messages
        .iter()
        .map(|msg| {
            let sender = match msg.player_id {
                Some(pid) => {
                    let username = gwp
                        .black
                        .as_ref()
                        .filter(|p| p.id == pid)
                        .or(gwp.white.as_ref().filter(|p| p.id == pid))
                        .map(|p| p.username.as_str());
                    state_serializer::sender_label(&gwp, pid, username)
                }
                None => "\u{2691}".to_string(), // ⚑ for system messages
            };
            serde_json::json!({
                "sender": sender,
                "text": msg.text,
                "move_number": msg.move_number,
                "sent_at": msg.created_at
            })
        })
        .collect();
    let chat_log_json =
        serde_json::to_string(&chat_log).unwrap_or_else(|_| "[]".to_string());

    let is_player = gwp.has_player(current_player.id);
    let is_creator = gwp.game.creator_id == Some(current_player.id);
    let has_open_slot = gwp.black.is_none() || gwp.white.is_none();

    let game_props = serde_json::to_string(&InitialGameProps {
        state: state
            .registry
            .get_or_init_engine(&state.db, &gwp.game)
            .await?
            .game_state(),
        black: gwp.black.as_ref().map(PlayerData::from),
        white: gwp.white.as_ref().map(PlayerData::from),
    })
    .unwrap();

    let tmpl = GamesShowTemplate {
        player_username: current_player.username.clone(),
        player_is_registered: current_player.is_registered(),
        player_data: serialize_player_data(&current_player),
        game_id: gwp.game.id,
        game_props,
        cols: gwp.game.cols,
        rows: gwp.game.rows,
        is_player,
        is_creator,
        is_private: gwp.game.is_private,
        has_open_slot,
        chat_log_json,
        gwp,
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
    current_player: CurrentPlayer,
    Path(id): Path<i64>,
) -> Result<Response, AppError> {
    let gwp = Game::find_with_players(&state.db, id).await?;

    if !gwp.has_player(current_player.id) {
        if gwp.black.is_none() {
            Game::set_black(&state.db, id, current_player.id).await?;
        } else if gwp.white.is_none() {
            Game::set_white(&state.db, id, current_player.id).await?;
        }

        let engine = engine_builder::build_engine(&state.db, &gwp.game).await?;
        game_actions::broadcast_game_state(&state, id, &engine).await;
    }

    Ok(Redirect::to(&format!("/games/{id}")).into_response())
}

#[derive(Deserialize)]
pub struct InvitationQuery {
    pub token: String,
    pub email: String,
}

// GET /games/:id/invitation
pub async fn invitation(
    State(state): State<AppState>,
    current_player: CurrentPlayer,
    Path(id): Path<i64>,
    Query(query): Query<InvitationQuery>,
) -> Result<Response, AppError> {
    let gwp = Game::find_with_players(&state.db, id).await?;

    // If current player is already in the game, redirect
    if gwp.has_player(current_player.id) {
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

    // Find the invited player by email
    let guest = crate::models::player::Player::find_by_email(&state.db, &query.email)
        .await?
        .ok_or_else(|| AppError::NotFound("Player not found".to_string()))?;

    // Add guest to game
    if gwp.black.is_none() {
        Game::set_black(&state.db, id, guest.id).await?;
    } else if gwp.white.is_none() {
        Game::set_white(&state.db, id, guest.id).await?;
    }

    Ok(Redirect::to(&format!("/games/{id}")).into_response())
}
