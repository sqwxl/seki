pub mod analysis;
pub mod api;
pub mod auth;
pub mod games;
pub mod health;
pub mod settings;
pub mod users;

pub(crate) fn wants_json(headers: &axum::http::HeaderMap) -> bool {
    headers
        .get(axum::http::header::ACCEPT)
        .and_then(|v| v.to_str().ok())
        .is_some_and(|s| s.contains("application/json"))
}
