use serde::{Deserialize, Serialize};

/// Time control variant matching seki-web's `TimeControlType` enum serialization.
/// Serialized as lowercase strings: `"none"`, `"fischer"`, `"byoyomi"`, `"correspondence"`.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[serde(rename_all = "lowercase")]
pub enum TimeControl {
    #[default]
    None,
    Fischer,
    Byoyomi,
    Correspondence,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct GameSettings {
    pub cols: i32,
    pub rows: i32,
    pub handicap: i32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_rating_difference_lower: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_rating_difference_higher: Option<i32>,
    pub rating_difference_lower_unlimited: bool,
    pub rating_difference_higher_unlimited: bool,
    pub rating_range_mode: String,
    pub time_control: TimeControl,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub main_time_secs: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub increment_secs: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub byoyomi_time_secs: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub byoyomi_periods: Option<i32>,
    pub is_private: bool,
    pub invite_only: bool,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub ranked: bool,
    pub rating_status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color_reason: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub calibration_policy_version: Option<String>,
}

/// Per-player clock period within the in-game clock state.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct ClockPlayerState {
    pub remaining_ms: i64,
    pub periods: i32,
}

/// Full in-game clock state (the JSON sent in `state` / `state_sync` messages).
/// Produced by `clock::ClockState::to_json()`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct InGameClock {
    #[serde(rename = "type")]
    pub clock_type: String,
    pub black: ClockPlayerState,
    pub white: ClockPlayerState,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub active_stone: Option<i32>,
    pub server_now_ms: i64,
}

/// Lightweight lobby clock snapshot (the `clock` field inside `LiveGameItem`).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct ClockSnapshot {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub black_ms: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub white_ms: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub black_periods: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub white_periods: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub active_stone: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
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
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct TerritoryScore {
    pub black: TerritorySide,
    pub white: TerritorySide,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct TerritorySide {
    pub territory: u32,
    pub captures: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct SettledTerritoryData {
    pub ownership: Vec<i8>,
    pub dead_stones: Vec<[u8; 2]>,
    pub score: TerritoryScore,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
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
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct RatingSnapshots {
    pub black: RatingSnapshot,
    pub white: RatingSnapshot,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct RatingSnapshot {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rating: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub deviation: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub volatility: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct Negotiations {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub undo_request: Option<serde_json::Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pregame_settings: Option<PregameSettingsData>,
}
