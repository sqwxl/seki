use axum::extract::Request;
use axum::routing::post;
use std::net::SocketAddr;
use tower::Layer as _;
use tower_http::normalize_path::NormalizePathLayer;

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "seki_web=debug".into()),
        )
        .init();

    let database_url =
        std::env::var("DATABASE_URL").unwrap_or_else(|_| "sqlite://seki.db".to_string());
    let pool = seki_web::db::create_pool(&database_url)
        .await
        .expect("Failed to create database pool");

    seki_web::db::run_migrations(&pool)
        .await
        .expect("Failed to run migrations");

    let secure_cookies = std::env::var("ENVIRONMENT").is_ok_and(|v| v == "production");
    let (app, state) = seki_web::build_router(pool, secure_cookies).await;

    let sweep_state = state.clone();
    tokio::spawn(async move {
        seki_web::services::clock_sweep::run(sweep_state).await;
    });

    #[cfg(debug_assertions)]
    let app = {
        let reload_layer = tower_livereload::LiveReloadLayer::new();
        seki_web::RELOADER.set(reload_layer.reloader()).ok();
        app.layer(reload_layer)
            .route("/__reload", post(seki_web::routes::reload::trigger))
    };

    let port = std::env::var("PORT").unwrap_or_else(|_| "3000".to_string());
    let addr = format!("0.0.0.0:{port}");
    tracing::info!("Starting seki-web on {addr}");

    let listener = tokio::net::TcpListener::bind(&addr)
        .await
        .expect("Failed to bind");

    let app = NormalizePathLayer::trim_trailing_slash().layer(app);
    axum::serve(
        listener,
        axum::ServiceExt::<Request>::into_make_service_with_connect_info::<SocketAddr>(app),
    )
    .await
    .expect("Server error");
}
