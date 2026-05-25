use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[serde(rename_all = "snake_case")]
pub enum RankStatus {
    Anonymous,
    NotParticipating,
    Unranked,
    Ranked,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct RankDto {
    #[serde(default)]
    pub qualifier: Option<String>,
    pub status: RankStatus,
    #[serde(default)]
    pub rating: Option<f64>,
    #[serde(default)]
    pub deviation: Option<f64>,
    #[serde(default)]
    pub volatility: Option<f64>,
    pub uncertain: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct UserData {
    pub id: i64,
    pub display_name: String,
    pub is_registered: bool,
    #[serde(default)]
    pub email: Option<String>,
    #[serde(default)]
    pub preferences: serde_json::Value,
    #[serde(default)]
    pub is_bot: Option<bool>,
    #[serde(default)]
    pub rank: Option<RankDto>,
}
