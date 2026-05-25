use axum::Json;
use axum::extract::{Path, Query, State};
use serde::{Deserialize, Serialize};

use crate::AppState;
use crate::error::AppError;
use crate::models::game::{Game, GameWithPlayers};
use crate::models::game_read::GameListRatingFilters;
use crate::models::message::Message;
use crate::models::rating::RatingProfile;
use crate::models::user::User;
use crate::services::engine_builder;
use crate::services::live::{self, LiveGameItem, build_live_items};
use crate::services::{
    game_joiner, presentation_actions, rating, state_assembly, state_serializer,
};
use crate::session::CurrentUser;
use crate::views::games_show::InitialGameProps;
use crate::views::{UserData, user_data_from_user_with_rank};

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
    pub derived_handicap_komi: Option<crate::services::rating::DerivedHandicapKomi>,
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
    use crate::services::rating::{
        can_participate_in_ranking, derive_handicap_komi, rank_for_profile, rank_for_user,
    };

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

    let (opponent_rank, derived_handicap_komi) = match opponent.as_deref() {
        Some(username) => {
            if let Some(opp_user) = User::find_by_username(&state.db, username).await? {
                let prof = RatingProfile::find(&state.db, opp_user.id).await?;
                let opp_rank = Some(rank_for_user(&opp_user, prof.as_ref()));
                let derived = current_user_profile
                    .as_ref()
                    .and_then(|p| prof.as_ref().map(|op| (p, op)))
                    .map(|(cp, op)| derive_handicap_komi(cp.rating, op.rating));
                (opp_rank, derived)
            } else {
                (None, None)
            }
        }
        None => (None, None),
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
        derived_handicap_komi,
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

    let has_open_slot = gwp.is_open();
    if !is_player
        && has_open_slot
        && gwp.game.requires_invite_token_to_join()
        && has_valid_invite_token
    {
        game_joiner::join_open_game(&state.db, &gwp, &current_user.user).await?;

        let game = Game::find_by_id(&state.db, id).await?;
        let engine = engine_builder::build_engine(&state.db, &game).await?;
        let updated_gwp = Game::find_with_players(&state.db, id).await?;
        if let Ok(loaded) =
            state_assembly::load_game_state(state, &updated_gwp, &engine, id, false).await
        {
            state
                .registry
                .broadcast(id, &loaded.value.to_string())
                .await;
        }
        crate::services::live::notify_game_created(state, &updated_gwp);

        gwp = updated_gwp;
        is_player = true;
    }

    if current_user.is_bot
        && !gwp.has_player(current_user.id)
        && gwp.game.creator_id != Some(current_user.id)
    {
        return Err(AppError::Forbidden(
            "Bot accounts can only view games they participate in.".to_string(),
        ));
    }

    if !crate::services::game_access::can_view_game(&gwp, Some(current_user.id), tokens) {
        return Err(AppError::Forbidden(
            "This game is protected. You need a valid token to view it.".to_string(),
        ));
    }

    let messages = Message::find_by_game_id(&state.db, id).await?;
    let sender_ids: Vec<i64> = messages.iter().filter_map(|msg| msg.user_id).collect();
    let sender_data = user_data_for_ids(&state.db, &sender_ids).await?;
    let chat_log = messages
        .into_iter()
        .map(|msg| GameChatEntry {
            id: msg.id,
            user_data: msg
                .user_id
                .and_then(|user_id| sender_data.get(&user_id).cloned()),
            text: msg.text,
            move_number: msg.move_number,
            sent_at: msg.created_at,
        })
        .collect();

    let is_creator = gwp.game.creator_id == Some(current_user.id);
    let has_open_slot = gwp.is_open();
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
    pub user_data: Option<UserData>,
    pub text: String,
    pub move_number: Option<i32>,
    pub sent_at: chrono::DateTime<chrono::Utc>,
}

async fn user_data_for_ids(
    db: &sqlx::SqlitePool,
    user_ids: &[i64],
) -> Result<std::collections::HashMap<i64, UserData>, AppError> {
    if user_ids.is_empty() {
        return Ok(std::collections::HashMap::new());
    }

    let profiles = RatingProfile::find_batch(db, user_ids).await?;
    let users = User::find_by_ids(db, user_ids).await?;
    let mut result = std::collections::HashMap::new();
    for user in users {
        let profile = profiles.get(&user.id);
        result.insert(user.id, user_data_from_user_with_rank(&user, profile));
    }

    Ok(result)
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
    let creator_profile = match gwp.creator.as_ref() {
        Some(u) => RatingProfile::find(&state.db, u.id).await?,
        None => None,
    };
    let opponent_profile = match gwp.opponent.as_ref() {
        Some(u) => RatingProfile::find(&state.db, u.id).await?,
        None => None,
    };

    let stage = state_serializer::resolve_stage(gwp, &engine);

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
    let can_join_game = can_join_game(&state.db, current_user, gwp, has_valid_access_token).await?;

    Ok(InitialGameProps {
        state: engine.game_state(),
        creator_id: gwp.game.creator_id,
        creator: gwp
            .creator
            .as_ref()
            .map(|user| user_data_from_user_with_rank(user, creator_profile.as_ref())),
        opponent: gwp
            .opponent
            .as_ref()
            .map(|user| user_data_from_user_with_rank(user, opponent_profile.as_ref())),
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
        can_join_game,
        has_valid_access_token,
        access_token: if is_creator || gwp.has_player(current_user.id) || has_valid_access_token {
            gwp.game.access_token.clone()
        } else {
            None
        },
    })
}

async fn can_join_game(
    pool: &crate::db::DbPool,
    current_user: &CurrentUser,
    gwp: &GameWithPlayers,
    has_valid_access_token: bool,
) -> Result<bool, AppError> {
    let has_open_slot = gwp.is_open();

    if gwp.has_player(current_user.id) || !has_open_slot {
        return Ok(false);
    }

    if gwp.game.requires_access_token_to_join() && !has_valid_access_token {
        return Ok(false);
    }

    if gwp.game.requires_invite_token_to_join() {
        return Ok(false);
    }

    if gwp.game.open_to.as_deref() == Some("registered") && !current_user.is_registered() {
        return Ok(false);
    }

    let has_finite_rating_range =
        !gwp.game.rating_difference_lower_unlimited || !gwp.game.rating_difference_higher_unlimited;
    if gwp.game.ranked || has_finite_rating_range {
        let joiner_profile = RatingProfile::find(pool, current_user.id).await?;
        if gwp.game.ranked
            && rating::can_join_ranked(&current_user.user, joiner_profile.as_ref()).is_err()
        {
            return Ok(false);
        }

        if has_finite_rating_range {
            let Some(creator_id) = gwp.game.creator_id else {
                return Ok(false);
            };
            let creator_profile = RatingProfile::find(pool, creator_id).await?;
            let (Some(joiner_profile), Some(creator_profile)) =
                (joiner_profile.as_ref(), creator_profile.as_ref())
            else {
                return Ok(!gwp.game.ranked);
            };
            if !rating::game_rating_range_allows(
                &gwp.game,
                creator_profile.rating,
                joiner_profile.rating,
            ) {
                return Ok(false);
            }
        }
    }

    Ok(true)
}
