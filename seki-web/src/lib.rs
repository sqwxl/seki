use axum::Router;
use axum::body::Body;
use axum::extract::DefaultBodyLimit;
use axum::http::{HeaderName, HeaderValue, Request, StatusCode, header};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, patch, post};
use rand::RngExt;
use std::convert::Infallible;
use std::path::{Path, PathBuf};
use tokio::sync::broadcast;
use tower::service_fn;
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
pub mod views;
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

/// Served in place of *.js files that only exist in older releases. A client
/// holding a stale module graph (cached build from a previous deploy)
/// evaluates this shim instead of white-screening on a 404; the reload lands
/// on the current build, whose graph only references current chunks, so the
/// shim never runs again.
/// ponytail: the sessionStorage guard only covers the pathological
/// stale-HTML container (pre-May-16 SW serving cached navigations) where the
/// reload would loop; in every normal case the post-reload graph is fresh.
const STALE_CHUNK_SHIM_JS: &str = r#"if(!sessionStorage.getItem("seki:stale")){sessionStorage.setItem("seki:stale","1");location.reload()}throw new Error("stale build");"#;

/// Serves the reload shim for *.js requests that only exist in older
/// releases. Everything else under /static/dist keeps 404ing as before.
async fn stale_dist_js_fallback(releases_dir: Option<PathBuf>, path: &str) -> Response {
    let rel = path.trim_start_matches('/');
    if !rel.ends_with(".js") || rel.split('/').any(|seg| seg == "..") {
        return StatusCode::NOT_FOUND.into_response();
    }

    let Some(releases_dir) = releases_dir else {
        return StatusCode::NOT_FOUND.into_response();
    };

    let Ok(mut entries) = tokio::fs::read_dir(&releases_dir).await else {
        return StatusCode::NOT_FOUND.into_response();
    };

    while let Ok(Some(entry)) = entries.next_entry().await {
        let candidate = entry.path().join("static").join("dist").join(rel);
        if tokio::fs::try_exists(&candidate).await.unwrap_or(false) {
            tracing::info!(path = %path, "stale chunk request, serving reload shim");
            return Response::builder()
                .status(StatusCode::OK)
                .header(header::CONTENT_TYPE, "text/javascript")
                .body(Body::from(STALE_CHUNK_SHIM_JS))
                .expect("static shim response");
        }
    }

    StatusCode::NOT_FOUND.into_response()
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
        None,
    )
    .await
}

/// Build the router with custom `GameRegistry` and `UserPresence` (for tests).
pub async fn build_router_with_registry_and_presence(
    pool: db::DbPool,
    session_secure: bool,
    registry: ws::registry::GameRegistry,
    presence: ws::presence::UserPresence,
    session_key: Option<tower_sessions::cookie::Key>,
) -> (Router, AppState) {
    let session_store = SqliteStore::new(pool.clone());
    session_store
        .migrate()
        .await
        .expect("Failed to migrate session store");

    let key = session_key.unwrap_or_else(tower_sessions::cookie::Key::generate);
    let session_layer = SessionManagerLayer::new(session_store)
        .with_private(key)
        .with_secure(session_secure)
        // TODO: Extract expiry duration to config var
        .with_expiry(Expiry::OnInactivity(Duration::days(30)));

    // TODO: Is 256 enough for production?
    let (live_tx, _) = broadcast::channel::<String>(256);

    let mailer = services::mailer::Mailer::from_env();

    // TODO: Read from config instead of env var (keep fallback)
    let static_dir = std::env::var("STATIC_DIR")
        .unwrap_or_else(|_| concat!(env!("CARGO_MANIFEST_DIR"), "/static").to_string());
    let static_dir_path = PathBuf::from(&static_dir);

    let jwt_secret = if let Ok(secret) = std::env::var("APP_CREDENTIAL_SECRET") {
        secret
    } else {
        // Load persisted secret from DB, or generate and store on first boot
        let secret = crate::models::server_config::load_jwt_secret(&pool)
            .await
            .expect("Failed to load JWT secret from DB")
            .unwrap_or_else(|| {
                use rand::distr::Alphanumeric;
                let mut rng = rand::rng();
                let s: String = (&mut rng)
                    .sample_iter(&Alphanumeric)
                    .take(64)
                    .map(char::from)
                    .collect();
                s
            });
        // Persist on first boot (ON CONFLICT upsert is idempotent on restarts)
        crate::models::server_config::store_jwt_secret(&pool, &secret)
            .await
            .expect("Failed to store JWT secret in DB");
        secret
    };

    let state = AppState {
        db: pool,
        registry,
        presence,
        presence_subs: ws::presence_subscriptions::PresenceSubscriptions::new(),
        live_tx,
        mailer,
        jwt_secret,
    };

    // Deploy layout: <releases>/<id>/static/dist is what each release serves;
    // STATIC_DIR points at the current release's static dir, so the releases
    // dir is two parents up. The shim lookup depends on old releases staying
    // on disk (install-release.sh retains them).
    let releases_dir = static_dir_path
        .parent()
        .and_then(Path::parent)
        .map(|p| p.join("releases"));

    let stale_dist_fallback = service_fn(move |req: Request<Body>| {
        let releases_dir = releases_dir.clone();
        let path = req.uri().path().to_string();
        async move { Ok::<_, Infallible>(stale_dist_js_fallback(releases_dir, &path).await) }
    });

    let static_assets = Router::new()
        .nest_service("/css", ServeDir::new(static_dir_path.join("css")))
        .nest_service(
            "/dist",
            ServeDir::new(static_dir_path.join("dist")).fallback(stale_dist_fallback),
        )
        .nest_service("/wasm", ServeDir::new(static_dir_path.join("wasm")))
        .layer(no_store_layer())
        .fallback_service(ServeDir::new(static_dir_path.clone()));

    let sw_route = Router::new()
        .route_service("/sw.js", ServeFile::new(static_dir_path.join("dist/sw.js")))
        .layer(no_store_layer());

    // TODO: Extract rate limit configs and review rate limits on all mutation routes
    let app = Router::new()
        .merge(sw_route)
        .route("/analysis", get(routes::spa::shell))
        .route("/bot", get(routes::spa::shell))
        .route("/players", get(routes::spa::shell))
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
        .fallback(routes::spa::not_found_page)
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

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::to_bytes;
    use std::fs;
    use std::sync::atomic::{AtomicU64, Ordering};

    static DIR_COUNTER: AtomicU64 = AtomicU64::new(0);

    fn fixture() -> PathBuf {
        let id = DIR_COUNTER.fetch_add(1, Ordering::Relaxed);
        let root =
            std::env::temp_dir().join(format!("seki-stale-test-{}-{id}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        let old = root.join("releases/20260816/static/dist/chunks");
        fs::create_dir_all(&old).unwrap();
        fs::write(old.join("chunk-OLD.js"), "old").unwrap();
        root
    }

    #[tokio::test]
    async fn stale_chunk_serves_reload_shim() {
        let releases = Some(fixture().join("releases"));

        let resp = stale_dist_js_fallback(releases.clone(), "/chunks/chunk-OLD.js").await;
        assert_eq!(resp.status(), StatusCode::OK);
        assert_eq!(resp.headers()[header::CONTENT_TYPE], "text/javascript");
        let js =
            String::from_utf8(to_bytes(resp.into_body(), 1024).await.unwrap().to_vec()).unwrap();
        assert!(js.contains("location.reload"));
        assert!(js.contains("sessionStorage"));

        // Unknown chunk and non-js paths keep 404ing.
        assert_eq!(
            stale_dist_js_fallback(releases.clone(), "/chunks/chunk-GONE.js")
                .await
                .status(),
            StatusCode::NOT_FOUND
        );
        assert_eq!(
            stale_dist_js_fallback(releases, "/styles.css")
                .await
                .status(),
            StatusCode::NOT_FOUND
        );
    }

    #[tokio::test]
    async fn stale_shim_rejects_traversal_and_missing_releases_dir() {
        let releases = Some(fixture().join("releases"));
        assert_eq!(
            stale_dist_js_fallback(releases, "/../secrets.js")
                .await
                .status(),
            StatusCode::NOT_FOUND
        );
        assert_eq!(
            stale_dist_js_fallback(None, "/chunks/chunk-OLD.js")
                .await
                .status(),
            StatusCode::NOT_FOUND
        );
    }

    #[test]
    fn releases_dir_derives_from_static_dir() {
        let static_dir = Path::new("/home/sqwxl/seki/current/static");
        let releases_dir = static_dir
            .parent()
            .and_then(Path::parent)
            .map(|p| p.join("releases"));
        assert_eq!(
            releases_dir,
            Some(PathBuf::from("/home/sqwxl/seki/releases"))
        );
    }
}
