use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RankStatus {
    Anonymous,
    NotParticipating,
    Unranked,
    Ranked,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RankDto {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub qualifier: Option<String>,
    pub status: RankStatus,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rating: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub deviation: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub volatility: Option<f64>,
    pub uncertain: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserData {
    pub id: i64,
    pub display_name: String,
    pub is_registered: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub email: Option<String>,
    #[serde(default)]
    pub preferences: serde_json::Value,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub is_bot: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rank: Option<RankDto>,
}
