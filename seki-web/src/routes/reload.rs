use axum::http::StatusCode;
use axum::response::IntoResponse;

pub async fn trigger() -> impl IntoResponse {
    #[cfg(debug_assertions)]
    if let Some(reloader) = crate::RELOADER.get() {
        reloader.reload();
        return (StatusCode::OK, "ok");
    }

    (StatusCode::NOT_FOUND, "not found")
}
