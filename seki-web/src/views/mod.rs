pub mod games_show;
pub mod shell;

use crate::models::rating::RatingProfile;
use crate::models::user::User;
use crate::services::rating::rank_for_user;

pub use seki_api::user::{RankDto, RankStatus, UserData};

pub fn user_data_from_user_with_rank(user: &User, profile: Option<&RatingProfile>) -> UserData {
    let mut preferences = user.preferences_with_defaults();
    if user.is_registered() {
        preferences["rating_participating"] =
            profile.is_none_or(|profile| profile.participating).into();
    }
    UserData {
        id: user.id,
        display_name: user.display_name().to_string(),
        is_registered: user.is_registered(),
        email: user.email.clone(),
        preferences,
        is_bot: if user.is_bot { Some(true) } else { None },
        rank: Some(rank_for_user(user, profile)),
    }
}

pub fn user_data_from_user(user: &User) -> UserData {
    UserData {
        id: user.id,
        display_name: user.display_name().to_string(),
        is_registered: user.is_registered(),
        email: user.email.clone(),
        preferences: user.preferences_with_defaults(),
        is_bot: if user.is_bot { Some(true) } else { None },
        rank: None,
    }
}
