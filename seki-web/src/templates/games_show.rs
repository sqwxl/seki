use askama::Template;
use go_engine::{GameState, Stage};
use serde::Serialize;

use crate::services::live::GameSettings;

use super::UserData;

#[derive(Serialize)]
pub struct InitialGameProps {
    pub state: GameState,
    pub creator_id: Option<i64>,
    pub black: Option<UserData>,
    pub white: Option<UserData>,
    pub komi: f64,
    pub stage: Stage,
    pub settings: GameSettings,
}

#[derive(Template)]
#[template(path = "games/show.html")]
pub struct GamesShowTemplate {
    pub user_username: String,
    pub user_is_registered: bool,
    pub user_data: String,
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
