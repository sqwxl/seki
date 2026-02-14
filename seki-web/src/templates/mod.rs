pub mod auth;
pub mod games_list;
pub mod games_new;
pub mod games_show;

use serde::Serialize;

use crate::models::player::Player;

#[derive(Serialize)]
pub struct PlayerData {
    pub id: i64,
    pub display_name: String,
    pub is_registered: bool,
}

impl From<&Player> for PlayerData {
    fn from(player: &Player) -> Self {
        Self {
            id: player.id,
            display_name: player.display_name().to_string(),
            is_registered: player.is_registered(),
        }
    }
}
