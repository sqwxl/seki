use askama::Template;
use go_engine::{GameState, Turn};
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
    pub stage: String,
    pub settings: GameSettings,
    pub moves: Vec<Turn>,
    pub current_turn_stone: i32,
    pub result: Option<String>,
    pub settled_territory: Option<SettledTerritoryData>,
    pub nigiri: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub invite_token: Option<String>,
}

#[derive(Template)]
#[template(path = "games/show.html")]
pub struct GamesShowTemplate {
    pub user_username: String,
    pub user_is_registered: bool,
    pub user_data: String,
    pub game_id: i64,
    pub game_props: String,
    pub chat_log_json: String,
    pub og_title: String,
    pub og_description: String,
}
