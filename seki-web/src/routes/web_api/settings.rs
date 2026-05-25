use axum::Json;
use axum::extract::State;

use crate::AppState;
use crate::error::AppError;
use crate::models::rating::RatingProfile;
use crate::session::CurrentUser;
use crate::views::{UserData, user_data_from_user_with_rank};

pub(crate) async fn session_me(
    State(state): State<AppState>,
    current_user: CurrentUser,
) -> Result<Json<UserData>, AppError> {
    let rating_profile = if current_user.is_registered() {
        RatingProfile::find(&state.db, current_user.id).await?
    } else {
        None
    };
    Ok(Json(user_data_from_user_with_rank(
        &current_user.user,
        rating_profile.as_ref(),
    )))
}
