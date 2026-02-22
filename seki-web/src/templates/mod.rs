pub mod analysis;
pub mod auth;
pub mod games_list;
pub mod games_new;
pub mod games_show;
pub mod user_profile;

use serde::Serialize;

use crate::models::user::User;

#[derive(Serialize)]
pub struct UserData {
    pub id: i64,
    pub display_name: String,
    pub is_registered: bool,
}

impl From<&User> for UserData {
    fn from(user: &User) -> Self {
        Self {
            id: user.id,
            display_name: user.display_name().to_string(),
            is_registered: user.is_registered(),
        }
    }
}
