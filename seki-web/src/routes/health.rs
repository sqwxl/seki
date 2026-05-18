use axum::Json;
use serde::Serialize;

#[derive(Serialize)]
pub struct HealthResponse {
    pub status: &'static str,
    pub release_id: String,
}

pub async fn health_check() -> Json<HealthResponse> {
    Json(HealthResponse {
        status: "ok",
        release_id: std::env::var("RELEASE_ID").unwrap_or_else(|_| "unknown".to_string()),
    })
}
