use axum::extract::{Path, Query, State};
use axum::http::Uri;
use axum::{Json, Router};
use serde::{Deserialize, Serialize};

use crate::AppState;
use crate::error::AppError;
use crate::models::game::{Game, GameWithPlayers};
use crate::models::message::Message;
use crate::models::user::User;
use crate::services::engine_builder;
use crate::services::live::{GameSettings, LiveGameItem, build_live_items};
use crate::services::{game_joiner, presentation_actions, state_serializer};
use crate::routes::FlashMessage;
use crate::session::CurrentUser;
use crate::templates::UserData;
use crate::templates::games_show::InitialGameProps;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/session/me", axum::routing::get(session_me))
        .route("/web/games", axum::routing::get(games_index))
        .route("/web/games/new", axum::routing::get(new_game))
        .route("/web/games/{id}", axum::routing::get(game_show))
        .route("/web/analysis", axum::routing::get(analysis))
        .route("/web/users/{username}", axum::routing::get(user_profile))
}

#[derive(Serialize)]
pub(crate) struct BootstrapPayload {
    pub url: Option<String>,
    pub data: Option<serde_json::Value>,
    pub flash: Option<FlashMessage>,
}

pub(crate) async fn bootstrap_for_location(
    state: &AppState,
    current_user: &CurrentUser,
    uri: &Uri,
) -> Result<BootstrapPayload, AppError> {
    let path = uri.path();
    let query = uri.query();
    let Some(url) = route_data_url(path, query) else {
        return Ok(BootstrapPayload {
            url: None,
            data: None,
            flash: None,
        });
    };

    let data = match path {
        "/" | "/games" => serde_json::to_value(load_games_index(state, current_user).await?)?,
        "/games/new" => serde_json::to_value(load_new_game(query_param(query, "opponent")))?,
        "/analysis" => serde_json::to_value(AnalysisData {})?,
        _ if path.starts_with("/games/") => {
            let game_id = path
                .trim_start_matches("/games/")
                .parse::<i64>()
                .map_err(|_| AppError::NotFound("Game not found".to_string()))?;
            let access_token = query_param(query, "access_token");
            let invite_token = query_param(query, "invite_token");
            let mut params = Vec::new();
            if let Some(token) = access_token {
                params.push(format!("access_token={token}"));
            }
            if let Some(token) = invite_token {
                params.push(format!("invite_token={token}"));
            }
            serde_json::to_value(load_game_show(state, current_user, game_id, params).await?)?
        }
        _ if path.starts_with("/users/") => {
            let username = path.trim_start_matches("/users/").to_string();
            serde_json::to_value(load_user_profile(state, current_user, username).await?)?
        }
        _ => {
            return Ok(BootstrapPayload {
                url: None,
                data: None,
                flash: None,
            });
        }
    };

    Ok(BootstrapPayload {
        url: Some(url),
        data: Some(data),
        flash: None,
    })
}

fn route_data_url(path: &str, query: Option<&str>) -> Option<String> {
    match path {
        "/" | "/games" => Some("/api/web/games".to_string()),
        "/games/new" => {
            let opponent = query_param(query, "opponent");
            Some(match opponent {
                Some(opponent) => format!("/api/web/games/new?opponent={opponent}"),
                None => "/api/web/games/new".to_string(),
            })
        }
        "/analysis" => Some("/api/web/analysis".to_string()),
        _ if path.starts_with("/games/") => {
            let access_token = query_param(query, "access_token");
            let invite_token = query_param(query, "invite_token");
            let mut params = Vec::new();
            if let Some(token) = access_token {
                params.push(format!("access_token={token}"));
            }
            if let Some(token) = invite_token {
                params.push(format!("invite_token={token}"));
            }
            Some(if params.is_empty() {
                path.replacen("/games", "/api/web/games", 1)
            } else {
                format!("{path}?{}", params.join("&")).replacen("/games", "/api/web/games", 1)
            })
        }
        _ if path.starts_with("/users/") => Some(path.replacen("/users", "/api/web/users", 1)),
        _ => None,
    }
}

fn query_param(query: Option<&str>, key: &str) -> Option<String> {
    query.and_then(|query| {
        query.split('&').find_map(|pair| {
            let mut parts = pair.splitn(2, '=');
            let k = parts.next()?;
            let v = parts.next().unwrap_or_default();
            if k == key { Some(v.to_string()) } else { None }
        })
    })
}

async fn session_me(current_user: CurrentUser) -> Json<UserData> {
    Json(UserData::from(&current_user.user))
}

#[derive(Serialize)]
struct GamesIndexData {
    player_id: i64,
    player_games: Vec<LiveGameItem>,
    public_games: Vec<LiveGameItem>,
}

async fn games_index(
    State(state): State<AppState>,
    current_user: CurrentUser,
) -> Result<Json<GamesIndexData>, AppError> {
    Ok(Json(load_games_index(&state, &current_user).await?))
}

async fn load_games_index(
    state: &AppState,
    current_user: &CurrentUser,
) -> Result<GamesIndexData, AppError> {
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

    Ok(GamesIndexData {
        player_id: current_user.id,
        player_games: player_items,
        public_games: public_items,
    })
}

#[derive(Deserialize)]
struct NewGameQuery {
    opponent: Option<String>,
}

#[derive(Serialize)]
struct NewGameData {
    opponent: Option<String>,
}

async fn new_game(Query(query): Query<NewGameQuery>) -> Json<NewGameData> {
    Json(load_new_game(query.opponent))
}

fn load_new_game(opponent: Option<String>) -> NewGameData {
    NewGameData { opponent }
}

#[derive(Deserialize)]
struct GameShowToken {
    access_token: Option<String>,
    invite_token: Option<String>,
}

async fn game_show(
    State(state): State<AppState>,
    current_user: CurrentUser,
    Path(id): Path<i64>,
    Query(query): Query<ShowGameQuery>,
) -> Result<Json<GamePageData>, AppError> {
    let mut params = Vec::new();
    if let Some(token) = query.access_token {
        params.push(format!("access_token={token}"));
    }
    if let Some(token) = query.invite_token {
        params.push(format!("invite_token={token}"));
    }
    Ok(Json(
        load_game_show(&state, &current_user, id, params).await?,
    ))
}

async fn load_game_show(
    state: &AppState,
    current_user: &CurrentUser,
    id: i64,
    query_params: Vec<String>,
) -> Result<GamePageData, AppError> {
    let mut query = GameShowToken {
        access_token: None,
        invite_token: None,
    };
    for pair in query_params {
        let mut parts = pair.splitn(2, '=');
        match (parts.next(), parts.next()) {
            (Some("access_token"), Some(value)) => query.access_token = Some(value.to_string()),
            (Some("invite_token"), Some(value)) => query.invite_token = Some(value.to_string()),
            _ => {}
        }
    }

    let mut gwp = Game::find_with_players(&state.db, id).await?;
    let mut is_player = gwp.has_player(current_user.id);
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

    let has_open_slot = gwp.black.is_none() || gwp.white.is_none();
    if !is_player
        && has_open_slot
        && gwp.game.requires_invite_token_to_join()
        && has_valid_invite_token
    {
        game_joiner::join_open_game(&state.db, &gwp, &current_user.user).await?;

        let game = Game::find_by_id(&state.db, id).await?;
        let engine = engine_builder::build_engine(&state.db, &game).await?;
        let updated_gwp = Game::find_with_players(&state.db, id).await?;
        let game_state =
            state_serializer::serialize_state(&updated_gwp, &engine, false, None, None, None);
        state.registry.broadcast(id, &game_state.to_string()).await;
        crate::services::live::notify_game_created(state, &updated_gwp);

        gwp = updated_gwp;
        is_player = true;
    }

    if gwp.game.requires_access_token_to_view() && !is_player && !has_valid_access_token {
        return Err(AppError::Forbidden(
            "This game is private. You need a valid access token to view it.".to_string(),
        ));
    }

    let messages = Message::find_by_game_id_with_sender(&state.db, id).await?;
    let chat_log = messages
        .into_iter()
        .map(|msg| GameChatEntry {
            user_id: msg.user_id,
            display_name: msg.display_name,
            text: msg.text,
            move_number: msg.move_number,
            sent_at: msg.created_at,
        })
        .collect();

    let is_creator = gwp.game.creator_id == Some(current_user.id);
    let has_open_slot = gwp.black.is_none() || gwp.white.is_none();
    let game_props = build_game_props(state, current_user, &gwp, has_valid_access_token).await?;

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

    Ok(GamePageData {
        game_id: gwp.game.id,
        game_props: InitialGameProps {
            access_token: if is_creator || is_player || has_valid_access_token {
                game_props.access_token
            } else {
                None
            },
            ..game_props
        },
        chat_log,
        og_title,
        og_description,
    })
}
#[derive(Deserialize)]
struct ShowGameQuery {
    access_token: Option<String>,
    invite_token: Option<String>,
}

#[derive(Serialize)]
struct GameChatEntry {
    user_id: Option<i64>,
    display_name: Option<String>,
    text: String,
    move_number: Option<i32>,
    sent_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Serialize)]
struct GamePageData {
    game_id: i64,
    game_props: InitialGameProps,
    chat_log: Vec<GameChatEntry>,
    og_title: String,
    og_description: String,
}

#[derive(Serialize)]
struct AnalysisData {}

async fn analysis() -> Json<AnalysisData> {
    Json(AnalysisData {})
}

#[derive(Serialize)]
struct UserGamesData {
    profile_user_id: i64,
    games: Vec<LiveGameItem>,
}

#[derive(Serialize)]
struct UserProfileData {
    profile_username: String,
    initial_games: UserGamesData,
    is_own_profile: bool,
    api_token: Option<String>,
    user_email: Option<String>,
    user_is_registered: bool,
}

async fn user_profile(
    State(state): State<AppState>,
    current_user: CurrentUser,
    Path(username): Path<String>,
) -> Result<Json<UserProfileData>, AppError> {
    Ok(Json(
        load_user_profile(&state, &current_user, username).await?,
    ))
}

async fn load_user_profile(
    state: &AppState,
    current_user: &CurrentUser,
    username: String,
) -> Result<UserProfileData, AppError> {
    let profile_user = User::find_by_username(&state.db, &username)
        .await?
        .ok_or_else(|| AppError::NotFound("User not found".to_string()))?;

    let games = Game::list_all_for_player(&state.db, profile_user.id)
        .await
        .unwrap_or_default();
    let items = build_live_items(&state.db, &games).await;
    let is_own_profile = current_user.id == profile_user.id;

    Ok(UserProfileData {
        profile_username: profile_user.username,
        initial_games: UserGamesData {
            profile_user_id: profile_user.id,
            games: items,
        },
        is_own_profile,
        api_token: if is_own_profile {
            current_user.api_token.clone()
        } else {
            None
        },
        user_email: if is_own_profile {
            current_user.email.clone()
        } else {
            None
        },
        user_is_registered: current_user.is_registered(),
    })
}

async fn build_game_props(
    state: &AppState,
    current_user: &CurrentUser,
    gwp: &GameWithPlayers,
    has_valid_access_token: bool,
) -> Result<InitialGameProps, AppError> {
    let engine = state
        .registry
        .get_or_init_engine(&state.db, &gwp.game)
        .await?;

    let stage = if gwp.game.result.is_some() {
        gwp.game.stage.clone()
    } else if gwp.game.stage == "unstarted" {
        "unstarted".to_string()
    } else if gwp.game.stage == "challenge" {
        "challenge".to_string()
    } else if engine.stage() == go_engine::Stage::Unstarted
        && gwp.game.stage != "unstarted"
        && gwp.game.stage != "challenge"
    {
        if gwp.game.handicap >= 2 {
            "white_to_play".to_string()
        } else {
            "black_to_play".to_string()
        }
    } else {
        engine.stage().to_string()
    };

    let settled_territory = if gwp.game.result.is_some() {
        Game::load_settled_territory(&state.db, gwp.game.id)
            .await
            .ok()
            .flatten()
            .map(|raw| state_serializer::build_settled_territory(&engine, gwp.game.komi, raw))
    } else {
        None
    };

    let can_start_pres = presentation_actions::can_start_presentation(
        &state.registry,
        gwp.game.id,
        gwp.game.result.is_some(),
        gwp.has_player(current_user.id),
        gwp.black.as_ref().map(|u| u.id),
        gwp.white.as_ref().map(|u| u.id),
        gwp.game.ended_at,
    )
    .await;

    let is_creator = gwp.game.creator_id == Some(current_user.id);

    Ok(InitialGameProps {
        state: engine.game_state(),
        creator_id: gwp.game.creator_id,
        black: gwp.black.as_ref().map(UserData::from),
        white: gwp.white.as_ref().map(UserData::from),
        komi: gwp.game.komi,
        stage,
        settings: GameSettings {
            cols: gwp.game.cols,
            rows: gwp.game.rows,
            handicap: engine_builder::game_handicap(&gwp.game) as i32,
            time_control: gwp.game.time_control,
            main_time_secs: gwp.game.main_time_secs,
            increment_secs: gwp.game.increment_secs,
            byoyomi_time_secs: gwp.game.byoyomi_time_secs,
            byoyomi_periods: gwp.game.byoyomi_periods,
            is_private: gwp.game.is_private,
            invite_only: gwp.game.invite_only,
        },
        moves: engine.moves().to_vec(),
        current_turn_stone: engine.current_turn_stone().to_int() as i32,
        result: gwp.game.result.clone(),
        settled_territory,
        nigiri: gwp.game.nigiri,
        can_start_presentation: can_start_pres,
        has_valid_access_token,
        access_token: if is_creator || gwp.has_player(current_user.id) || has_valid_access_token {
            gwp.game.access_token.clone()
        } else {
            None
        },
    })
}
