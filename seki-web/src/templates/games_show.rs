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
    pub can_start_presentation: bool,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub has_valid_token: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub invite_token: Option<String>,
}
