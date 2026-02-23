use axum::Router;
use axum::routing::{get, post};
use tokio::sync::broadcast;
use tower::ServiceBuilder;
use tower_http::services::ServeDir;
use tower_http::set_header::SetResponseHeaderLayer;
use tower_sessions::cookie::time::Duration;
use tower_sessions::{Expiry, SessionManagerLayer};
use tower_sessions_sqlx_store::PostgresStore;

pub mod db;
pub mod error;
pub mod models;
pub mod routes;
pub mod services;
pub mod session;
pub mod templates;
pub mod utils;
pub mod ws;

#[derive(Clone)]
pub struct AppState {
    pub db: db::DbPool,
    pub registry: ws::registry::GameRegistry,
    pub live_tx: broadcast::Sender<String>,
}

pub async fn build_router(pool: db::DbPool, session_secure: bool) -> (Router, AppState) {
    let session_store = PostgresStore::new(pool.clone());
    session_store
        .migrate()
        .await
        .expect("Failed to migrate session store");

    let session_layer = SessionManagerLayer::new(session_store)
        .with_secure(session_secure)
        .with_expiry(Expiry::OnInactivity(Duration::days(30)));

    let (live_tx, _) = broadcast::channel::<String>(256);
    let state = AppState {
        db: pool,
        registry: ws::registry::GameRegistry::new(),
        live_tx,
    };

    let app = Router::new()
        .route("/analysis", get(routes::analysis::analysis_board))
        .route("/", get(routes::games::new_game))
        .route("/games", get(routes::games::list_games))
        .route("/games", post(routes::games::create_game))
        .route("/games/{id}", get(routes::games::show_game))
        .route("/games/{id}/join", post(routes::games::join_game))
        .route("/games/{id}/invitation", get(routes::games::invitation))
        .route("/games/{id}/rematch", post(routes::games::rematch_game))
        .route("/users/{username}", get(routes::users::profile))
        .route("/users/{username}", post(routes::users::update_username))
        .route("/register", get(routes::auth::register_form))
        .route("/register", post(routes::auth::register))
        .route("/login", get(routes::auth::login_form))
        .route("/login", post(routes::auth::login))
        .route("/logout", post(routes::auth::logout))
        .route("/settings", get(routes::settings::settings_page))
        .route("/settings/token", post(routes::settings::generate_token))
        .route("/ws", get(ws::live::ws_upgrade))
        .nest("/api", routes::api::router())
        .route("/up", get(routes::health::health_check))
        .nest_service(
            "/static",
            ServiceBuilder::new()
                .layer(SetResponseHeaderLayer::overriding(
                    axum::http::header::CACHE_CONTROL,
                    axum::http::HeaderValue::from_static("no-cache"),
                ))
                .service(ServeDir::new(std::env::var("STATIC_DIR").unwrap_or_else(
                    |_| concat!(env!("CARGO_MANIFEST_DIR"), "/static").to_string(),
                ))),
        )
        .layer(session_layer)
        .with_state(state.clone());

    (app, state)
}
