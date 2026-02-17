use axum::Router;
use axum::extract::Request;
use axum::routing::{get, post};
use tokio::sync::broadcast;
use tower::Layer as _;
use tower_http::normalize_path::NormalizePathLayer;
use tower_http::services::ServeDir;
use tower_sessions::cookie::time::Duration;
use tower_sessions::{Expiry, SessionManagerLayer};
use tower_sessions_sqlx_store::PostgresStore;

mod db;
mod error;
mod models;
mod routes;
mod services;
mod session;
mod templates;
mod utils;
mod ws;

#[derive(Clone)]
pub struct AppState {
    pub db: db::DbPool,
    pub registry: ws::registry::GameRegistry,
    pub live_tx: broadcast::Sender<String>,
}

#[tokio::main]
async fn main() {
    // Initialize tracing
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "seki_web=debug".into()),
        )
        .init();

    // Database setup
    let database_url = std::env::var("DATABASE_URL")
        .unwrap_or_else(|_| "postgres://seki:seki@localhost:5432/seki".to_string());
    let pool = db::create_pool(&database_url)
        .await
        .expect("Failed to create database pool");

    db::run_migrations(&pool)
        .await
        .expect("Failed to run migrations");

    // Session store
    let session_store = PostgresStore::new(pool.clone());
    session_store
        .migrate()
        .await
        .expect("Failed to migrate session store");

    let secure_cookies = std::env::var("ENVIRONMENT").is_ok_and(|v| v == "production");
    let session_layer = SessionManagerLayer::new(session_store)
        .with_secure(secure_cookies)
        .with_expiry(Expiry::OnInactivity(Duration::days(30)));

    // App state
    let (live_tx, _) = broadcast::channel::<String>(256);
    let state = AppState {
        db: pool,
        registry: ws::registry::GameRegistry::new(),
        live_tx,
    };

    // Build router
    let app = Router::new()
        // Game routes
        .route("/analysis", get(routes::analysis::analysis_board))
        .route("/", get(routes::games::new_game))
        .route("/games", get(routes::games::list_games))
        .route("/games", post(routes::games::create_game))
        .route("/games/{id}", get(routes::games::show_game))
        .route("/games/{id}/join", post(routes::games::join_game))
        .route("/games/{id}/invitation", get(routes::games::invitation))
        // Auth routes
        .route("/register", get(routes::auth::register_form))
        .route("/register", post(routes::auth::register))
        .route("/login", get(routes::auth::login_form))
        .route("/login", post(routes::auth::login))
        .route("/logout", post(routes::auth::logout))
        // Settings
        .route("/settings", get(routes::settings::settings_page))
        .route("/settings/token", post(routes::settings::generate_token))
        // WebSocket
        .route("/ws", get(ws::live::ws_upgrade))
        // API
        .nest("/api", routes::api::router())
        // Health check
        .route("/up", get(routes::health::health_check))
        // Static files
        .nest_service(
            "/static",
            ServeDir::new(
                std::env::var("STATIC_DIR")
                    .unwrap_or_else(|_| concat!(env!("CARGO_MANIFEST_DIR"), "/static").to_string()),
            ),
        )
        // Middleware
        .layer(session_layer)
        .with_state(state);

    #[cfg(debug_assertions)]
    let app = app.layer(tower_livereload::LiveReloadLayer::new());

    // Start server
    let port = std::env::var("PORT").unwrap_or_else(|_| "3000".to_string());
    let addr = format!("0.0.0.0:{port}");
    tracing::info!("Starting seki-web on {addr}");

    let listener = tokio::net::TcpListener::bind(&addr)
        .await
        .expect("Failed to bind");

    // NormalizePathLayer must wrap the router (not .layer()) so it runs
    // before routing — this makes /games/ equivalent to /games.

    let app = NormalizePathLayer::trim_trailing_slash().layer(app);
    axum::serve(
        listener,
        axum::ServiceExt::<Request>::into_make_service(app),
    )
    .await
    .expect("Server error");
}
