pub mod games_show;
pub mod shell;

use serde::Serialize;

use crate::models::rating::RatingProfile;
use crate::models::user::User;
use crate::services::rating::{RankDto, rank_for_user};

#[derive(Debug, Clone, Serialize, utoipa::ToSchema)]
pub struct UserData {
    pub id: i64,
    pub display_name: String,
    pub is_registered: bool,
    pub email: Option<String>,
    pub preferences: serde_json::Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rank: Option<RankDto>,
}

impl UserData {
    pub fn from_user_with_rank(user: &User, profile: Option<&RatingProfile>) -> Self {
        let mut preferences = user.preferences_with_defaults();
        if user.is_registered() {
            preferences["rating_participating"] =
                profile.is_none_or(|profile| profile.participating).into();
        }
        Self {
            id: user.id,
            display_name: user.display_name().to_string(),
            is_registered: user.is_registered(),
            email: user.email.clone(),
            preferences,
            rank: Some(rank_for_user(user, profile)),
        }
    }
}

impl From<&User> for UserData {
    fn from(user: &User) -> Self {
        Self {
            id: user.id,
            display_name: user.display_name().to_string(),
            is_registered: user.is_registered(),
            email: user.email.clone(),
            preferences: user.preferences_with_defaults(),
            rank: None,
        }
    }
}
