use serde::Serialize;
use serde_json::json;
use std::collections::HashMap;

use crate::AppState;
use crate::db::DbPool;
use crate::models::game::{Game, GameWithPlayers, TimeControlType};
use crate::models::rating::RatingProfile;
use crate::models::turn::TurnRow;
use crate::models::user::User;
use crate::services::engine_builder;
use crate::services::rating::{
    PROVISIONAL_DEVIATION_THRESHOLD, RankDto, RankStatus, RatingCalibrationPolicy,
};
use crate::templates::UserData;

#[derive(Serialize, utoipa::ToSchema)]
pub struct GameSettings {
    pub cols: i32,
    pub rows: i32,
    pub handicap: i32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_rating_difference_lower: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_rating_difference_higher: Option<i32>,
    pub rating_difference_lower_unlimited: bool,
    pub rating_difference_higher_unlimited: bool,
    pub rating_range_mode: String,
    pub time_control: TimeControlType,
    pub main_time_secs: Option<i32>,
    pub increment_secs: Option<i32>,
    pub byoyomi_time_secs: Option<i32>,
    pub byoyomi_periods: Option<i32>,
    pub is_private: bool,
    pub invite_only: bool,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub ranked: bool,
    pub rating_status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color_reason: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub calibration_policy_version: Option<String>,
}

/// Full game item sent in lobby `init` and `game_created` messages.
#[derive(Serialize, utoipa::ToSchema)]
pub struct LiveGameItem {
    pub id: i64,
    pub creator_id: Option<i64>,
    pub creator: Option<UserData>,
    pub opponent: Option<UserData>,
    pub stage: String,
    pub result: Option<String>,
    pub black: Option<UserData>,
    pub white: Option<UserData>,
    pub settings: GameSettings,
    pub move_count: Option<usize>,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub ranked: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub derived_handicap: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub derived_komi: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub derived_color_reason: Option<String>,
}

impl LiveGameItem {
    pub fn from_gwp(
        gwp: &GameWithPlayers,
        move_count: Option<usize>,
        profiles: &HashMap<i64, RatingProfile>,
    ) -> Self {
        Self {
            id: gwp.game.id,
            creator_id: gwp.game.creator_id,
            creator: gwp
                .creator
                .as_ref()
                .map(|user| UserData::from_user_with_rank(user, profiles.get(&user.id))),
            opponent: gwp
                .opponent
                .as_ref()
                .map(|user| UserData::from_user_with_rank(user, profiles.get(&user.id))),
            stage: gwp.game.stage.clone(),
            result: gwp.game.result.clone(),
            black: gwp.black.as_ref().map(|user| {
                user_data_for_game_player(user, &gwp.game, true, profiles.get(&user.id))
            }),
            white: gwp.white.as_ref().map(|user| {
                user_data_for_game_player(user, &gwp.game, false, profiles.get(&user.id))
            }),
            settings: game_settings_for_game(&gwp.game),
            move_count,
            ranked: gwp.game.ranked,
            derived_handicap: gwp.game.derived_handicap,
            derived_komi: gwp.game.derived_komi,
            derived_color_reason: gwp.game.derived_color_reason.clone(),
        }
    }
}

/// Build `LiveGameItem`s from a batch of games, fetching move counts and rating profiles in one query each.
pub async fn build_live_items(pool: &DbPool, games: &[GameWithPlayers]) -> Vec<LiveGameItem> {
    let game_ids: Vec<i64> = games.iter().map(|g| g.game.id).collect();
    let counts = TurnRow::count_by_game_ids(pool, &game_ids)
        .await
        .unwrap_or_default();
    let mut user_ids = std::collections::HashSet::new();
    for gwp in games {
        if let Some(ref u) = gwp.creator {
            user_ids.insert(u.id);
        }
        if let Some(ref u) = gwp.opponent {
            user_ids.insert(u.id);
        }
        if let Some(ref u) = gwp.black {
            user_ids.insert(u.id);
        }
        if let Some(ref u) = gwp.white {
            user_ids.insert(u.id);
        }
    }
    let profiles: HashMap<i64, RatingProfile> = if user_ids.is_empty() {
        HashMap::new()
    } else {
        let ids: Vec<i64> = user_ids.into_iter().collect();
        RatingProfile::find_batch(pool, &ids)
            .await
            .unwrap_or_default()
    };
    games
        .iter()
        .map(|gwp| {
            let mc = counts.get(&gwp.game.id).copied().map(|n| n as usize);
            LiveGameItem::from_gwp(gwp, mc, &profiles)
        })
        .collect()
}

/// Lightweight update (no settings — clients already have them from `init` or `game_created`).
#[derive(Serialize)]
struct GameUpdate {
    id: i64,
    creator: Option<UserData>,
    opponent: Option<UserData>,
    stage: String,
    result: Option<String>,
    black: Option<UserData>,
    white: Option<UserData>,
    move_count: Option<usize>,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    ranked: bool,
    settings: GameSettings,
}

/// Notify live clients that a new game appeared (created or joined).
pub fn notify_game_created(state: &AppState, gwp: &GameWithPlayers) {
    let profiles: HashMap<i64, RatingProfile> = HashMap::new();
    let item = LiveGameItem::from_gwp(gwp, None, &profiles);
    let msg = json!({
        "kind": "game_created",
        "game": item,
    })
    .to_string();

    let _ = state.live_tx.send(msg);
}

/// Notify live clients that an existing game's state changed.
///
/// `stage` overrides `gwp.game.stage` because callers may hold a stale `gwp`
/// loaded before the engine mutated.
pub fn notify_game_updated(
    state: &AppState,
    gwp: &GameWithPlayers,
    move_count: Option<usize>,
    stage: &str,
) {
    let profiles: HashMap<i64, RatingProfile> = HashMap::new();
    let update =
        GameUpdate {
            id: gwp.game.id,
            stage: stage.to_string(),
            result: gwp.game.result.clone(),
            creator: gwp
                .creator
                .as_ref()
                .map(|user| UserData::from_user_with_rank(user, profiles.get(&user.id))),
            opponent: gwp
                .opponent
                .as_ref()
                .map(|user| UserData::from_user_with_rank(user, profiles.get(&user.id))),
            black: gwp.black.as_ref().map(|user| {
                user_data_for_game_player(user, &gwp.game, true, profiles.get(&user.id))
            }),
            white: gwp.white.as_ref().map(|user| {
                user_data_for_game_player(user, &gwp.game, false, profiles.get(&user.id))
            }),
            move_count,
            ranked: gwp.game.ranked,
            settings: game_settings_for_game(&gwp.game),
        };
    let msg = json!({
        "kind": "game_updated",
        "game": update,
    })
    .to_string();

    let _ = state.live_tx.send(msg);
}

pub fn game_settings_for_game(game: &Game) -> GameSettings {
    GameSettings {
        cols: game.cols,
        rows: game.rows,
        handicap: engine_builder::game_handicap(game) as i32,
        max_rating_difference_lower: game.max_rating_difference_lower,
        max_rating_difference_higher: game.max_rating_difference_higher,
        rating_difference_lower_unlimited: game.rating_difference_lower_unlimited,
        rating_difference_higher_unlimited: game.rating_difference_higher_unlimited,
        rating_range_mode: game.rating_range_mode.clone(),
        time_control: game.time_control,
        main_time_secs: game.main_time_secs,
        increment_secs: game.increment_secs,
        byoyomi_time_secs: game.byoyomi_time_secs,
        byoyomi_periods: game.byoyomi_periods,
        is_private: game.is_private,
        invite_only: game.invite_only,
        ranked: game.ranked,
        rating_status: if game.ranked { "ranked" } else { "unranked" }.to_string(),
        color_reason: game.derived_color_reason.clone(),
        calibration_policy_version: game.calibration_policy_version.clone(),
    }
}

pub fn user_data_for_game_player(
    user: &User,
    game: &Game,
    is_black: bool,
    profile: Option<&RatingProfile>,
) -> UserData {
    let mut data = UserData::from_user_with_rank(user, profile);
    if let Some(snapshot_rank) = rank_from_game_snapshot(game, is_black) {
        data.rank = Some(snapshot_rank);
    }
    data
}

fn rank_from_game_snapshot(game: &Game, is_black: bool) -> Option<RankDto> {
    let (rating, deviation, volatility) = if is_black {
        (
            game.black_rating_before?,
            game.black_deviation_before?,
            game.black_volatility_before?,
        )
    } else {
        (
            game.white_rating_before?,
            game.white_deviation_before?,
            game.white_volatility_before?,
        )
    };

    Some(RankDto {
        qualifier: Some(RatingCalibrationPolicy::default().rank_label(rating)),
        status: RankStatus::Ranked,
        rating: Some(rating),
        deviation: Some(deviation),
        volatility: Some(volatility),
        uncertain: deviation > PROVISIONAL_DEVIATION_THRESHOLD,
    })
}

/// Notify live clients that a game was removed (aborted/deleted).
pub fn notify_game_removed(state: &AppState, game_id: i64) {
    let msg = json!({
        "kind": "game_removed",
        "game_id": game_id,
    })
    .to_string();

    let _ = state.live_tx.send(msg);
}
