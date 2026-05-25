use axum::Json;
use axum::extract::{Path, State};
use serde::Serialize;

use crate::AppState;
use crate::error::AppError;
use crate::models::game::Game;
use crate::models::rating::RatingProfile;
use crate::services::live::LiveGameItem;
use crate::services::live::build_live_items;
use crate::services::rating::ProfileRatingDto;
use crate::session::CurrentUser;
use crate::views::{UserData, user_data_from_user_with_rank};

#[derive(Serialize)]
pub(crate) struct UserGamesData {
    pub profile_user_id: i64,
    pub games: Vec<LiveGameItem>,
}

#[derive(Serialize)]
pub(crate) struct UserProfileData {
    pub profile_username: String,
    pub profile_user: UserData,
    pub rating: Option<ProfileRatingDto>,
    pub initial_games: UserGamesData,
    pub is_own_profile: bool,
    pub api_token: Option<String>,
    pub user_email: Option<String>,
    pub user_is_registered: bool,
}

pub(crate) async fn user_profile(
    State(state): State<AppState>,
    current_user: CurrentUser,
    Path(username): Path<String>,
) -> Result<Json<UserProfileData>, AppError> {
    Ok(Json(
        load_user_profile(&state, &current_user, username).await?,
    ))
}

pub(crate) async fn load_user_profile(
    state: &AppState,
    current_user: &CurrentUser,
    username: String,
) -> Result<UserProfileData, AppError> {
    use crate::models::user::User;
    use crate::services::rating::profile_rating_summary;

    let profile_user = User::find_by_username(&state.db, &username)
        .await?
        .ok_or_else(|| AppError::NotFound("User not found".to_string()))?;

    let mut games = Game::list_all_for_player(&state.db, profile_user.id)
        .await
        .unwrap_or_default();
    games.retain(|gwp| {
        crate::services::game_access::can_view_game(
            gwp,
            Some(current_user.id),
            crate::services::game_access::GameViewTokens::default(),
        )
    });
    let items = build_live_items(&state.db, &games).await;
    let is_own_profile = current_user.id == profile_user.id;
    let profile_rating = RatingProfile::find(&state.db, profile_user.id).await?;
    let rating = profile_rating_summary(&state.db, &profile_user, current_user.id).await?;

    Ok(UserProfileData {
        profile_username: profile_user.username.clone(),
        profile_user: user_data_from_user_with_rank(&profile_user, profile_rating.as_ref()),
        rating,
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
