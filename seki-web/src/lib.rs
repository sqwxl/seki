use axum::Router;
use axum::routing::{get, patch, post};
use tokio::sync::broadcast;
use tower_http::services::ServeDir;
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
    pub presence: ws::presence::UserPresence,
    pub presence_subs: ws::presence_subscriptions::PresenceSubscriptions,
    pub live_tx: broadcast::Sender<String>,
    pub mailer: services::mailer::Mailer,
}

pub async fn build_router(pool: db::DbPool, session_secure: bool) -> (Router, AppState) {
    build_router_with_presence(pool, session_secure, ws::presence::UserPresence::new()).await
}

/// Build the router with a custom `UserPresence` (e.g. for tests with zero grace period).
pub async fn build_router_with_presence(
    pool: db::DbPool,
    session_secure: bool,
    presence: ws::presence::UserPresence,
) -> (Router, AppState) {
    build_router_with_registry_and_presence(
        pool,
        session_secure,
        ws::registry::GameRegistry::new(),
        presence,
    )
    .await
}

/// Build the router with custom `GameRegistry` and `UserPresence` (for tests).
pub async fn build_router_with_registry_and_presence(
    pool: db::DbPool,
    session_secure: bool,
    registry: ws::registry::GameRegistry,
    presence: ws::presence::UserPresence,
) -> (Router, AppState) {
    let session_store = PostgresStore::new(pool.clone());
    session_store
        .migrate()
        .await
        .expect("Failed to migrate session store");

    let session_layer = SessionManagerLayer::new(session_store)
        .with_secure(session_secure)
        .with_expiry(Expiry::OnInactivity(Duration::days(30)));

    let (live_tx, _) = broadcast::channel::<String>(256);
    let mailer = services::mailer::Mailer::from_env();
    let state = AppState {
        db: pool,
        registry,
        presence,
        presence_subs: ws::presence_subscriptions::PresenceSubscriptions::new(),
        live_tx,
        mailer,
    };

    let app = Router::new()
        .route("/analysis", get(routes::spa::shell))
        .route("/", get(routes::spa::shell))
        .route("/games", get(routes::spa::shell))
        .route("/games/new", get(routes::spa::shell))
        .route("/games", post(routes::games::create_game))
        .route("/games/{id}", get(routes::spa::shell))
        .route("/games/{id}/join", post(routes::games::join_game))
        .route("/games/{id}/rematch", post(routes::games::rematch_game))
        .route("/users/search", get(routes::users::search_users))
        .route("/users/{username}", get(routes::spa::shell))
        .route("/users/{username}", post(routes::users::update_username))
        .route("/register", get(routes::spa::shell))
        .route("/register", post(routes::auth::register))
        .route("/login", get(routes::spa::shell))
        .route("/login", post(routes::auth::login))
        .route("/logout", post(routes::auth::logout))
        .route("/settings", get(routes::spa::shell))
        .route("/settings/token", post(routes::settings::generate_token))
        .route("/settings/email", post(routes::settings::update_email))
        .route(
            "/settings/preferences",
            patch(routes::settings::update_preferences),
        )
        .route("/ws", get(ws::live::ws_upgrade))
        .nest("/api", routes::api::router().merge(routes::web_api::router()))
        .route("/up", get(routes::health::health_check))
        .nest_service(
            "/static",
            ServeDir::new(
                std::env::var("STATIC_DIR").unwrap_or_else(|_| {
                    concat!(env!("CARGO_MANIFEST_DIR"), "/static").to_string()
                }),
            ),
        )
        .layer(session_layer)
        .with_state(state.clone());

    (app, state)
}
