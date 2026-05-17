use axum::Json;
use axum::extract::{Path, Query, State};
use serde::{Deserialize, Serialize};

use crate::AppState;
use crate::error::AppError;
use crate::models::game::{Game, GameWithPlayers};
use crate::models::game_read::GameListRatingFilters;
use crate::models::message::Message;
use crate::models::rating::RatingProfile;
use crate::services::engine_builder;
use crate::services::live::{self, LiveGameItem, build_live_items};
use crate::services::{game_joiner, presentation_actions, state_serializer};
use crate::session::CurrentUser;
use crate::templates::games_show::InitialGameProps;

#[derive(Serialize)]
pub(crate) struct GamesIndexData {
    pub player_id: i64,
    pub player_games: Vec<LiveGameItem>,
    pub public_games: Vec<LiveGameItem>,
}

#[derive(Deserialize)]
pub(crate) struct GamesIndexQuery {
    pub rated_status: Option<String>,
    pub min_rating: Option<i32>,
    pub max_rating: Option<i32>,
}

fn parse_rating_filters(query: &GamesIndexQuery) -> GameListRatingFilters {
    use crate::models::game_read::RatedStatusFilter;
    GameListRatingFilters {
        rated_status: match query.rated_status.as_deref() {
            Some("ranked") => Some(RatedStatusFilter::Ranked),
            Some("unranked") => Some(RatedStatusFilter::Unranked),
            _ => None,
        },
        min_rating: query.min_rating,
        max_rating: query.max_rating,
    }
}

pub(crate) async fn games_index(
    State(state): State<AppState>,
    current_user: CurrentUser,
    Query(query): Query<GamesIndexQuery>,
) -> Result<Json<GamesIndexData>, AppError> {
    Ok(Json(
        load_games_index(&state, &current_user, parse_rating_filters(&query)).await?,
    ))
}

pub(crate) async fn load_games_index(
    state: &AppState,
    current_user: &CurrentUser,
    rating_filters: GameListRatingFilters,
) -> Result<GamesIndexData, AppError> {
    let (player_games, public_games) = tokio::join!(
        Game::list_for_player(&state.db, current_user.id),
        Game::list_public_filtered(&state.db, rating_filters),
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
pub(crate) struct NewGameQuery {
    pub opponent: Option<String>,
}

#[derive(Serialize)]
pub(crate) struct NewGameData {
    pub opponent: Option<String>,
    pub user_is_registered: bool,
    pub rating: NewGameRatingData,
    pub eligible_opponents: Vec<EligibleOpponent>,
    pub opponent_rank: Option<crate::services::rating::RankDto>,
}

#[derive(Serialize)]
pub(crate) struct EligibleOpponent {
    pub id: i64,
    pub username: String,
    pub rank: Option<crate::services::rating::RankDto>,
}

#[derive(Serialize)]
pub(crate) struct NewGameRatingData {
    pub can_create_ranked: bool,
    pub current_user_rank: Option<crate::services::rating::RankDto>,
    pub ranked_unavailable_reason: Option<String>,
}

pub(crate) async fn new_game(
    State(state): State<AppState>,
    current_user: CurrentUser,
    Query(query): Query<NewGameQuery>,
) -> Result<Json<NewGameData>, AppError> {
    Ok(Json(
        load_new_game(&state, &current_user, query.opponent).await?,
    ))
}

pub(crate) async fn load_new_game(
    state: &AppState,
    current_user: &CurrentUser,
    opponent: Option<String>,
) -> Result<NewGameData, AppError> {
    use crate::models::user::User;
    use crate::services::rating::{can_participate_in_ranking, rank_for_profile, rank_for_user};

    let user_is_registered = current_user.is_registered();
    let current_user_profile = if user_is_registered {
        Some(RatingProfile::get_or_create(&state.db, current_user.id).await?)
    } else {
        None
    };
    let current_user_rank = current_user_profile
        .as_ref()
        .map(|profile| rank_for_profile(Some(profile)));

    let ranked_unavailable_reason = if !user_is_registered {
        Some("Register or sign in to create ranked games".to_string())
    } else if !can_participate_in_ranking(&current_user.user, current_user_profile.as_ref()) {
        Some("Turn on rating participation to create ranked games".to_string())
    } else {
        None
    };

    let mut eligible_opponents = Vec::new();
    if user_is_registered {
        let users = User::list_eligible_opponents(
            &state.db,
            current_user.id,
            ranked_unavailable_reason.is_none(),
        )
        .await
        .unwrap_or_default();
        for user in users {
            let profile = RatingProfile::find(&state.db, user.id).await?;
            eligible_opponents.push(EligibleOpponent {
                id: user.id,
                username: user.username.clone(),
                rank: Some(rank_for_user(&user, profile.as_ref())),
            });
        }
    }

    let opponent_rank = match opponent.as_deref() {
        Some(username) => {
            if let Some(opp_user) = User::find_by_username(&state.db, username).await? {
                let prof = RatingProfile::find(&state.db, opp_user.id).await?;
                Some(rank_for_user(&opp_user, prof.as_ref()))
            } else {
                None
            }
        }
        None => None,
    };

    Ok(NewGameData {
        opponent,
        user_is_registered,
        rating: NewGameRatingData {
            can_create_ranked: ranked_unavailable_reason.is_none(),
            current_user_rank,
            ranked_unavailable_reason,
        },
        eligible_opponents,
        opponent_rank,
    })
}

#[derive(Deserialize)]
struct GameShowToken {
    access_token: Option<String>,
    invite_token: Option<String>,
}

pub(crate) async fn game_show(
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

pub(crate) async fn load_game_show(
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
    let tokens = crate::services::game_access::GameViewTokens {
        access_token: query.access_token.as_deref(),
        invite_token: query.invite_token.as_deref(),
    };
    let has_valid_access_token = crate::services::game_access::has_valid_token(&gwp, tokens);
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

    if !crate::services::game_access::can_view_game(&gwp, Some(current_user.id), tokens) {
        return Err(AppError::Forbidden(
            "This game is protected. You need a valid token to view it.".to_string(),
        ));
    }

    let messages = Message::find_by_game_id_with_sender(&state.db, id).await?;
    let chat_log = messages
        .into_iter()
        .map(|msg| GameChatEntry {
            id: msg.id,
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
pub(crate) struct ShowGameQuery {
    access_token: Option<String>,
    invite_token: Option<String>,
}

#[derive(Serialize)]
pub(crate) struct GameChatEntry {
    pub id: i64,
    pub user_id: Option<i64>,
    pub display_name: Option<String>,
    pub text: String,
    pub move_number: Option<i32>,
    pub sent_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Serialize)]
pub(crate) struct GamePageData {
    pub game_id: i64,
    pub game_props: InitialGameProps,
    pub chat_log: Vec<GameChatEntry>,
    pub og_title: String,
    pub og_description: String,
}

#[derive(Serialize)]
pub(crate) struct AnalysisData {}

pub(crate) async fn analysis() -> Json<AnalysisData> {
    Json(AnalysisData {})
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

    let black_profile = match gwp.black.as_ref() {
        Some(u) => RatingProfile::find(&state.db, u.id).await?,
        None => None,
    };
    let white_profile = match gwp.white.as_ref() {
        Some(u) => RatingProfile::find(&state.db, u.id).await?,
        None => None,
    };

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
        black: gwp.black.as_ref().map(|user| {
            live::user_data_for_game_player(user, &gwp.game, true, black_profile.as_ref())
        }),
        white: gwp.white.as_ref().map(|user| {
            live::user_data_for_game_player(user, &gwp.game, false, white_profile.as_ref())
        }),
        komi: gwp.game.komi,
        stage,
        settings: live::game_settings_for_game(&gwp.game),
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
