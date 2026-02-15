use askama::Template;
use go_engine::GameState;
use serde::Serialize;

use crate::models::game::GameWithPlayers;

use super::PlayerData;

#[derive(Serialize)]
pub struct InitialGameProps {
    pub state: GameState,
    pub black: Option<PlayerData>,
    pub white: Option<PlayerData>,
}

#[derive(Template)]
#[template(path = "games/show.html")]
pub struct GamesShowTemplate {
    pub player_username: Option<String>,
    pub player_data: String,
    pub gwp: GameWithPlayers,
    pub game_id: i64,
    pub game_props: String,
    pub cols: i32,
    pub rows: i32,
    pub is_player: bool,
    pub is_creator: bool,
    pub is_private: bool,
    pub has_open_slot: bool,
    pub chat_log_json: String,
}
