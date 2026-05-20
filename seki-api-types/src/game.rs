use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GameSettings {
    pub cols: i32,
    pub rows: i32,
    pub handicap: i32,
    pub max_rating_difference_lower: Option<i32>,
    pub max_rating_difference_higher: Option<i32>,
    pub rating_difference_lower_unlimited: bool,
    pub rating_difference_higher_unlimited: bool,
    pub rating_range_mode: String,
    pub time_control: String,
    pub main_time_secs: Option<i32>,
    pub increment_secs: Option<i32>,
    pub byoyomi_time_secs: Option<i32>,
    pub byoyomi_periods: Option<i32>,
    pub is_private: bool,
    pub invite_only: bool,
    #[serde(default)]
    pub ranked: bool,
    pub rating_status: String,
    pub color_reason: Option<String>,
    pub calibration_policy_version: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TerritoryState {
    pub ownership: Vec<i8>,
    pub dead_stones: Vec<[u8; 2]>,
    pub score: TerritoryScore,
    pub black_approved: bool,
    pub white_approved: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expires_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TerritoryScore {
    pub black: TerritorySide,
    pub white: TerritorySide,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TerritorySide {
    pub territory: u32,
    pub captures: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SettledTerritoryData {
    pub ownership: Vec<i8>,
    pub dead_stones: Vec<[u8; 2]>,
    pub score: TerritoryScore,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PregameSettingsData {
    pub handicap: i32,
    pub komi: f64,
    pub color: String,
    pub black_approved: bool,
    pub white_approved: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expires_at: Option<String>,
    pub max_handicap: u8,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClockState {
    pub black_time_ms: Option<i64>,
    pub white_time_ms: Option<i64>,
    pub black_periods: Option<i32>,
    pub white_periods: Option<i32>,
    pub active_stone: Option<i32>,
    pub last_move_at: Option<String>,
    pub expires_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RatingSnapshots {
    pub black: RatingSnapshot,
    pub white: RatingSnapshot,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RatingSnapshot {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rating: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub deviation: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub volatility: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Negotiations {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub undo_request: Option<serde_json::Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pregame_settings: Option<PregameSettingsData>,
}
