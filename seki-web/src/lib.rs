use axum::Router;
use axum::extract::DefaultBodyLimit;
use axum::http::{HeaderName, HeaderValue, header};
use axum::routing::{get, patch, post};
use rand::RngExt;
use std::path::PathBuf;
use tokio::sync::broadcast;
use tower_governor::GovernorLayer;
use tower_governor::governor::GovernorConfigBuilder;
use tower_http::services::{ServeDir, ServeFile};
use tower_http::set_header::SetResponseHeaderLayer;
use tower_sessions::cookie::time::Duration;
use tower_sessions::{Expiry, SessionManagerLayer};
use tower_sessions_sqlx_store::SqliteStore;

#[cfg(debug_assertions)]
pub static RELOADER: std::sync::OnceLock<tower_livereload::Reloader> = std::sync::OnceLock::new();

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
    pub jwt_secret: String,
}

fn no_store_layer() -> SetResponseHeaderLayer<HeaderValue> {
    SetResponseHeaderLayer::overriding(header::CACHE_CONTROL, HeaderValue::from_static("no-store"))
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
    let session_store = SqliteStore::new(pool.clone());
    session_store
        .migrate()
        .await
        .expect("Failed to migrate session store");

    let session_layer = SessionManagerLayer::new(session_store)
        .with_secure(session_secure)
        .with_expiry(Expiry::OnInactivity(Duration::days(30)));

    let (live_tx, _) = broadcast::channel::<String>(256);
    let mailer = services::mailer::Mailer::from_env();
    let static_dir = std::env::var("STATIC_DIR")
        .unwrap_or_else(|_| concat!(env!("CARGO_MANIFEST_DIR"), "/static").to_string());
    let static_dir_path = PathBuf::from(&static_dir);
    let jwt_secret = std::env::var("APP_CREDENTIAL_SECRET").unwrap_or_else(|_| {
        use rand::distr::Alphanumeric;
        let mut rng = rand::rng();
        let s: String = (&mut rng)
            .sample_iter(&Alphanumeric)
            .take(64)
            .map(char::from)
            .collect();
        s
    });
    let state = AppState {
        db: pool,
        registry,
        presence,
        presence_subs: ws::presence_subscriptions::PresenceSubscriptions::new(),
        live_tx,
        mailer,
        jwt_secret,
    };
    let static_assets = Router::new()
        .nest_service("/css", ServeDir::new(static_dir_path.join("css")))
        .nest_service("/dist", ServeDir::new(static_dir_path.join("dist")))
        .nest_service("/wasm", ServeDir::new(static_dir_path.join("wasm")))
        .layer(no_store_layer())
        .fallback_service(ServeDir::new(static_dir_path.clone()));
    let sw_route = Router::new()
        .route_service("/sw.js", ServeFile::new(static_dir_path.join("dist/sw.js")))
        .layer(no_store_layer());
    let app = Router::new()
        .merge(sw_route)
        .route("/analysis", get(routes::spa::shell))
        .route("/", get(routes::spa::shell))
        .route("/games", get(routes::spa::shell))
        .route("/games/new", get(routes::spa::shell))
        .route("/games/challenge/{username}", get(routes::spa::shell))
        .route(
            "/games",
            post(routes::games::create_game).layer(GovernorLayer::new(
                GovernorConfigBuilder::default()
                    .per_second(1)
                    .burst_size(30)
                    .use_headers()
                    .finish()
                    .expect("valid rate limit config"),
            )),
        )
        .route("/games/{id}", get(routes::spa::shell))
        .route("/games/{id}/join", post(routes::games::join_game))
        .route("/games/{id}/rematch", post(routes::games::rematch_game))
        .route("/users/search", get(routes::users::search_users))
        .route("/users/{username}", get(routes::spa::shell))
        .route("/users/{username}", post(routes::users::update_username))
        .route("/register", get(routes::spa::shell))
        .route(
            "/register",
            post(routes::auth::register).layer(GovernorLayer::new(
                GovernorConfigBuilder::default()
                    .per_second(4)
                    .burst_size(8)
                    .use_headers()
                    .finish()
                    .expect("valid rate limit config"),
            )),
        )
        .route("/login", get(routes::spa::shell))
        .route(
            "/login",
            post(routes::auth::login).layer(GovernorLayer::new(
                GovernorConfigBuilder::default()
                    .per_second(4)
                    .burst_size(8)
                    .use_headers()
                    .finish()
                    .expect("valid rate limit config"),
            )),
        )
        .route("/logout", post(routes::auth::logout))
        .route("/settings", get(routes::spa::shell))
        .route("/settings/token", post(routes::settings::generate_token))
        .route("/settings/email", post(routes::settings::update_email))
        .route(
            "/settings/preferences",
            patch(routes::settings::update_preferences),
        )
        .route(
            "/ws",
            get(ws::live::ws_upgrade).layer(GovernorLayer::new(
                GovernorConfigBuilder::default()
                    .per_second(1)
                    .burst_size(60)
                    .use_headers()
                    .finish()
                    .expect("valid rate limit config"),
            )),
        )
        .nest(
            "/api",
            routes::api::router()
                .merge(routes::web_api::router())
                .layer(GovernorLayer::new(
                    GovernorConfigBuilder::default()
                        .per_second(5)
                        .burst_size(300)
                        .use_headers()
                        .finish()
                        .expect("valid rate limit config"),
                )),
        )
        .route("/up", get(routes::health::health_check))
        .nest("/static", static_assets)
        .route_service(
            "/manifest.json",
            ServeFile::new(static_dir_path.join("manifest.json")),
        )
        .layer(SetResponseHeaderLayer::if_not_present(
            header::REFERRER_POLICY,
            HeaderValue::from_static("same-origin"),
        ))
        .layer(SetResponseHeaderLayer::if_not_present(
            header::X_CONTENT_TYPE_OPTIONS,
            HeaderValue::from_static("nosniff"),
        ))
        .layer(SetResponseHeaderLayer::if_not_present(
            HeaderName::from_static("content-security-policy"),
            HeaderValue::from_static(
                "default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' https://cdn.jsdelivr.net; connect-src 'self' ws: wss:; img-src 'self' data:; style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
            ),
        ))
        .layer(SetResponseHeaderLayer::if_not_present(
            HeaderName::from_static("permissions-policy"),
            HeaderValue::from_static("camera=(), microphone=(), geolocation=()"),
        ))
        .layer(SetResponseHeaderLayer::if_not_present(
            header::X_FRAME_OPTIONS,
            HeaderValue::from_static("DENY"),
        ))
        .layer(DefaultBodyLimit::max(256 * 1024))
        .layer(session_layer)
        .with_state(state.clone());

    (app, state)
}
