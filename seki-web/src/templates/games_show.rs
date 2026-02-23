use askama::Template;
use go_engine::{GameState, Stage, Turn};
use serde::Serialize;

use crate::services::live::GameSettings;
use crate::services::state_serializer::SettledTerritoryData;

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
    pub moves: Vec<Turn>,
    pub current_turn_stone: i32,
    pub result: Option<String>,
    pub settled_territory: Option<SettledTerritoryData>,
}

#[derive(Template)]
#[template(path = "games/show.html")]
pub struct GamesShowTemplate {
    pub user_username: String,
    pub user_is_registered: bool,
    pub user_data: String,
    pub game_id: i64,
    pub game_props: String,
    pub is_player: bool,
    pub is_creator: bool,
    pub is_private: bool,
    pub has_open_slot: bool,
    pub chat_log_json: String,
    pub og_title: String,
    pub og_description: String,
}
