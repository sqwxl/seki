use go_engine::{Engine, Stage};

use crate::AppState;
use crate::models::game::{Game, GameWithPlayers};
use crate::models::pregame_settings::PregameSettingsNegotiation;
use crate::models::rating::RatingProfile;
use crate::services::clock::{ClockState, TimeControl};
use crate::services::state_serializer;

pub struct LoadedGameState {
    pub value: serde_json::Value,
    pub territory: Option<state_serializer::TerritoryData>,
    pub clock: Option<(ClockState, TimeControl)>,
}

/// Load all optional game state components and return a fully assembled
/// serialized value, plus the raw components for callers that need them
/// (e.g. API response builders that extract sub-fields).
pub async fn load_game_state(
    state: &AppState,
    gwp: &GameWithPlayers,
    engine: &Engine,
    game_id: i64,
    undo_requested: bool,
) -> Result<LoadedGameState, Box<dyn std::error::Error + Send + Sync>> {
    let game_is_done = gwp.game.result.is_some();

    let territory = if !game_is_done && engine.stage() == Stage::TerritoryReview {
        state
            .registry
            .get_territory_review(game_id)
            .await
            .map(|tr| {
                state_serializer::compute_territory_data(
                    engine,
                    &tr.dead_stones,
                    gwp.game.komi,
                    tr.black_approved,
                    tr.white_approved,
                    gwp.game.territory_review_expires_at,
                )
            })
    } else {
        None
    };

    let tc = TimeControl::from_game(&gwp.game);
    let clock = if !tc.is_none() {
        let c = match state.registry.get_clock(game_id).await {
            Some(c) => c,
            None => {
                let c = ClockState::from_game(&gwp.game).unwrap_or_else(|| {
                    tracing::warn!(
                        game_id,
                        "Clock columns NULL on timed game — resetting to fresh clock"
                    );
                    ClockState::new(&tc).expect("invalid time control")
                });
                state.registry.update_clock(game_id, c.clone()).await;
                c
            }
        };
        Some((c, tc))
    } else {
        None
    };
    let clock_ref = clock.as_ref().map(|(c, tc)| (c, tc));

    let pregame_settings = if gwp.game.stage == "unstarted" {
        PregameSettingsNegotiation::find(&state.db, game_id)
            .await
            .ok()
            .flatten()
    } else {
        None
    };

    let settled_territory = if game_is_done && territory.is_none() {
        Game::load_settled_territory(&state.db, game_id)
            .await
            .ok()
            .flatten()
            .map(|raw| state_serializer::build_settled_territory(engine, gwp.game.komi, raw))
    } else {
        None
    };

    let (black_profile, white_profile) = load_player_profiles(&state.db, gwp).await;

    let value = state_serializer::serialize_state(
        gwp,
        engine,
        undo_requested,
        territory.as_ref(),
        settled_territory.as_ref(),
        pregame_settings.as_ref(),
        clock_ref,
        black_profile.as_ref(),
        white_profile.as_ref(),
    );

    Ok(LoadedGameState {
        value,
        territory,
        clock,
    })
}

async fn load_player_profiles(
    db: &sqlx::SqlitePool,
    gwp: &GameWithPlayers,
) -> (Option<RatingProfile>, Option<RatingProfile>) {
    let black_profile = match gwp.black.as_ref() {
        Some(u) => RatingProfile::find(db, u.id).await.ok().flatten(),
        None => None,
    };
    let white_profile = match gwp.white.as_ref() {
        Some(u) => RatingProfile::find(db, u.id).await.ok().flatten(),
        None => None,
    };
    (black_profile, white_profile)
}
