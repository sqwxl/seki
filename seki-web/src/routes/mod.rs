pub mod api;
pub mod auth;
pub mod games;
pub mod health;
pub mod settings;
pub mod spa;
pub mod users;
pub mod web_api;

pub(crate) fn wants_json(headers: &axum::http::HeaderMap) -> bool {
    headers
        .get(axum::http::header::ACCEPT)
        .and_then(|v| v.to_str().ok())
        .is_some_and(|s| s.contains("application/json"))
}

pub(crate) fn serialize_user_data(user: &crate::session::CurrentUser) -> String {
    serde_json::to_string(&crate::templates::UserData::from(&user.user))
        .unwrap_or_else(|_| "{}".to_string())
}
