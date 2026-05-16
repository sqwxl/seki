pub mod games_show;
pub mod shell;

use serde::Serialize;

use crate::models::rating::RatingProfile;
use crate::models::user::User;
use crate::services::rating::{rank_for_profile, RankDto};

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
        Self {
            id: user.id,
            display_name: user.display_name().to_string(),
            is_registered: user.is_registered(),
            email: user.email.clone(),
            preferences: user.preferences.clone(),
            rank: Some(rank_for_profile(profile)),
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
            preferences: user.preferences.clone(),
            rank: None,
        }
    }
}
