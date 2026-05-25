#![allow(dead_code)]

use std::path::PathBuf;
use std::sync::Arc;
use std::sync::OnceLock;
use std::sync::atomic::{AtomicU64, Ordering};

use argon2::password_hash::SaltString;
use argon2::password_hash::rand_core::OsRng;
use argon2::{Argon2, PasswordHasher};
use futures_util::{SinkExt, StreamExt};
use reqwest::cookie::{CookieStore, Jar};
use serde_json::{Value, json};
use sqlx::SqlitePool;
use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions};
use std::str::FromStr;
use tokio::net::TcpListener;
use tokio::sync::OnceCell;
use tokio_tungstenite::tungstenite;

static DB_COUNTER: AtomicU64 = AtomicU64::new(0);

fn test_db_path() -> PathBuf {
    let id = DB_COUNTER.fetch_add(1, Ordering::Relaxed);
    std::env::temp_dir().join(format!("seki-test-{}-{id}.db", std::process::id()))
}

/// Cache the argon2 password hash — computed only once for the entire test process.
fn password_hash() -> &'static str {
    static HASH: OnceLock<String> = OnceLock::new();
    HASH.get_or_init(|| {
        let salt = SaltString::generate(&mut OsRng);
        Argon2::default()
            .hash_password(b"testpassword", &salt)
            .unwrap()
            .to_string()
    })
}

/// Template DB path, created once with migrations + users, then copied per test.
static TEMPLATE: OnceCell<PathBuf> = OnceCell::const_new();

async fn get_or_create_template() -> &'static PathBuf {
    TEMPLATE
        .get_or_init(|| async {
            let path =
                std::env::temp_dir().join(format!("seki-template-{}.db", std::process::id()));
            let db_url = format!("sqlite://{}", path.display());
            // Use DELETE journal mode so the template file is self-contained
            // (no WAL/SHM files) and can be safely copied per test.
            let options = SqliteConnectOptions::from_str(&db_url)
                .unwrap()
                .create_if_missing(true)
                .journal_mode(SqliteJournalMode::Delete);
            let pool = SqlitePoolOptions::new()
                .max_connections(1)
                .connect_with(options)
                .await
                .unwrap();
            seki_web::db::run_migrations(&pool).await.unwrap();

            let hash = password_hash();
            for (token, username, api_token) in [
                (
                    "black-session-token",
                    "test-black",
                    "test-black-api-token-12345",
                ),
                (
                    "white-session-token",
                    "test-white",
                    "test-white-api-token-67890",
                ),
                (
                    "spectator-session-token",
                    "test-spectator",
                    "test-spectator-api-token-99999",
                ),
            ] {
                sqlx::query(
                    "INSERT INTO users (session_token, username, password_hash, api_token) \
                     VALUES ($1, $2, $3, $4)",
                )
                .bind(token)
                .bind(username)
                .bind(hash)
                .bind(api_token)
                .execute(&pool)
                .await
                .unwrap();
            }

            pool.close().await;
            path
        })
        .await
}

async fn create_test_db() -> SqlitePool {
    let template = get_or_create_template().await;
    let dest = test_db_path();
    std::fs::copy(template, &dest).unwrap();
    let db_url = format!("sqlite://{}", dest.display());
    seki_web::db::create_pool(&db_url).await.unwrap()
}

/// Fixed session signing key — ensures LightServer sessions work without
/// the axum server infrastructure that normally generates the key lazily.
fn session_signing_key() -> tower_sessions::cookie::Key {
    static KEY: OnceLock<tower_sessions::cookie::Key> = OnceLock::new();
    KEY.get_or_init(tower_sessions::cookie::Key::generate)
        .clone()
}

/// A running test server with three pre-authenticated users.
pub struct TestServer {
    pub addr: String,
    pub pool: SqlitePool,
    pub black_id: i64,
    pub white_id: i64,
    pub spectator_id: i64,
    pub client_black: reqwest::Client,
    pub client_white: reqwest::Client,
    pub client_spectator: reqwest::Client,
    jar_black: Arc<Jar>,
    jar_white: Arc<Jar>,
    jar_spectator: Arc<Jar>,
}

impl TestServer {
    pub async fn start() -> Self {
        let pool = create_test_db().await;

        let black_id: i64 =
            sqlx::query_scalar("SELECT id FROM users WHERE username = 'test-black'")
                .fetch_one(&pool)
                .await
                .unwrap();
        let white_id: i64 =
            sqlx::query_scalar("SELECT id FROM users WHERE username = 'test-white'")
                .fetch_one(&pool)
                .await
                .unwrap();
        let spectator_id: i64 =
            sqlx::query_scalar("SELECT id FROM users WHERE username = 'test-spectator'")
                .fetch_one(&pool)
                .await
                .unwrap();

        let presence = seki_web::ws::presence::UserPresence::with_grace_period(
            std::time::Duration::from_millis(0),
        );
        let (router, _state) = seki_web::build_router_with_registry_and_presence(
            pool.clone(),
            false,
            seki_web::ws::registry::GameRegistry::with_max_grace(100),
            presence,
            None,
        )
        .await;
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap().to_string();

        tokio::spawn(async move {
            use axum::extract::Request;
            use std::net::SocketAddr;
            use tower::Layer as _;
            use tower_http::normalize_path::NormalizePathLayer;

            let app = NormalizePathLayer::trim_trailing_slash().layer(router);
            axum::serve(
                listener,
                axum::ServiceExt::<Request>::into_make_service_with_connect_info::<SocketAddr>(app),
            )
            .await
            .unwrap();
        });

        let jar_black = Arc::new(Jar::default());
        let client_black = reqwest::Client::builder()
            .cookie_provider(jar_black.clone())
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .unwrap();

        let jar_white = Arc::new(Jar::default());
        let client_white = reqwest::Client::builder()
            .cookie_provider(jar_white.clone())
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .unwrap();

        let jar_spectator = Arc::new(Jar::default());
        let client_spectator = reqwest::Client::builder()
            .cookie_provider(jar_spectator.clone())
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .unwrap();

        let base = format!("http://{addr}");

        // POST login — the handler creates a session if one doesn't exist.
        // No need for a prior GET /login.
        client_black
            .post(format!("{base}/login"))
            .form(&[("username", "test-black"), ("password", "testpassword")])
            .send()
            .await
            .unwrap();

        client_white
            .post(format!("{base}/login"))
            .form(&[("username", "test-white"), ("password", "testpassword")])
            .send()
            .await
            .unwrap();

        client_spectator
            .post(format!("{base}/login"))
            .form(&[("username", "test-spectator"), ("password", "testpassword")])
            .send()
            .await
            .unwrap();

        TestServer {
            addr,
            pool,
            black_id,
            white_id,
            spectator_id,
            client_black,
            client_white,
            client_spectator,
            jar_black,
            jar_white,
            jar_spectator,
        }
    }

    pub async fn create_game(&self) -> i64 {
        let resp = self
            .client_black
            .post(format!("http://{}/api/games", self.addr))
            .header("Authorization", "Bearer test-black-api-token-12345")
            .json(&json!({
                "cols": 9,
            }))
            .send()
            .await
            .unwrap();
        assert!(
            resp.status().is_success(),
            "create_game failed: {}",
            resp.status()
        );
        let body: Value = resp.json().await.unwrap();
        body["id"].as_i64().expect("game id missing from response")
    }

    pub async fn join_game(&self, game_id: i64) -> Value {
        let resp = self
            .client_white
            .post(format!("http://{}/api/games/{game_id}/join", self.addr))
            .header("Authorization", "Bearer test-white-api-token-67890")
            .json(&json!({}))
            .send()
            .await
            .unwrap();
        assert!(
            resp.status().is_success(),
            "join_game failed: {}",
            resp.status()
        );
        let body = resp.json().await.unwrap();
        self.finalize_pregame_settings_if_present(game_id).await;
        body
    }

    pub async fn create_game_with(&self, opts: Value) -> i64 {
        let mut body = json!({ "cols": 9 });
        if let Some(obj) = opts.as_object() {
            for (k, v) in obj {
                body[k] = v.clone();
            }
        }
        if (body.get("komi").is_some()
            || body.get("handicap").is_some()
            || body.get("color").is_some())
            && body.get("invite_username").is_none()
            && body.get("invite_email").is_none()
        {
            body["invite_username"] = json!("test-white");
        }
        if (body.get("invite_username").is_some() || body.get("invite_email").is_some())
            && body["ranked"].as_bool() != Some(true)
        {
            if body.get("komi").is_none() {
                body["komi"] = json!(6.5);
            }
            if body.get("handicap").is_none() {
                body["handicap"] = json!(0);
            }
            if body.get("color").is_none() {
                body["color"] = json!("black");
            }
        }
        if body["ranked"].as_bool() == Some(true) && body.get("time_control").is_none() {
            body["time_control"] = json!("fischer");
            body["main_time_secs"] = json!(600);
            body["increment_secs"] = json!(5);
        }
        let resp = self
            .client_black
            .post(format!("http://{}/api/games", self.addr))
            .header("Authorization", "Bearer test-black-api-token-12345")
            .json(&body)
            .send()
            .await
            .unwrap();
        assert!(
            resp.status().is_success(),
            "create_game failed: {}",
            resp.status()
        );
        let body: Value = resp.json().await.unwrap();
        body["id"].as_i64().expect("game id missing from response")
    }

    pub async fn create_and_join(&self) -> i64 {
        let game_id = self.create_game().await;
        self.join_game(game_id).await;
        game_id
    }

    pub async fn create_and_join_with(&self, opts: Value) -> i64 {
        let game_id = self.create_game_with(opts).await;
        self.join_game(game_id).await;
        game_id
    }

    async fn finalize_pregame_settings_if_present(&self, game_id: i64) {
        let Some((handicap, komi, color)): Option<(i32, f64, String)> = sqlx::query_as(
            "SELECT handicap, komi, color FROM pregame_setting_negotiations WHERE game_id = $1",
        )
        .bind(game_id)
        .fetch_optional(&self.pool)
        .await
        .unwrap() else {
            return;
        };

        let (creator_id, opponent_id): (Option<i64>, Option<i64>) =
            sqlx::query_as("SELECT creator_id, opponent_id FROM games WHERE id = $1")
                .bind(game_id)
                .fetch_one(&self.pool)
                .await
                .unwrap();
        let creator_id = creator_id.unwrap();
        let opponent_id = opponent_id.unwrap();
        let (final_black, final_white) = if color == "white" {
            (opponent_id, creator_id)
        } else {
            (creator_id, opponent_id)
        };
        let stage = if handicap >= 2 {
            "white_to_play"
        } else {
            "black_to_play"
        };

        let mut tx = self.pool.begin().await.unwrap();
        sqlx::query(
            "UPDATE games SET handicap = $2, komi = $3, black_id = $4, white_id = $5, \
             nigiri = false, stage = $6, cached_engine_state = NULL, updated_at = CURRENT_TIMESTAMP \
             WHERE id = $1",
        )
        .bind(game_id)
        .bind(handicap)
        .bind(komi)
        .bind(final_black)
        .bind(final_white)
        .bind(stage)
        .execute(&mut *tx)
        .await
        .unwrap();
        sqlx::query("DELETE FROM pregame_setting_negotiations WHERE game_id = $1")
            .bind(game_id)
            .execute(&mut *tx)
            .await
            .unwrap();
        tx.commit().await.unwrap();
    }

    pub async fn create_challenge(&self) -> i64 {
        self.create_game_with(json!({"invite_username": "test-white"}))
            .await
    }

    pub async fn ws_black(&self) -> WsClient {
        self.ws_connect(&self.jar_black).await
    }

    pub async fn ws_white(&self) -> WsClient {
        self.ws_connect(&self.jar_white).await
    }

    pub async fn ws_spectator(&self) -> WsClient {
        self.ws_connect(&self.jar_spectator).await
    }

    pub async fn create_private_game(&self) -> i64 {
        self.create_game_with(json!({"is_private": true})).await
    }

    pub async fn get_access_token(&self, game_id: i64) -> String {
        sqlx::query_scalar::<_, String>("SELECT access_token FROM games WHERE id = $1")
            .bind(game_id)
            .fetch_one(&self.pool)
            .await
            .unwrap()
    }

    pub async fn get_invite_token(&self, game_id: i64) -> String {
        sqlx::query_scalar::<_, String>("SELECT invite_token FROM games WHERE id = $1")
            .bind(game_id)
            .fetch_one(&self.pool)
            .await
            .unwrap()
    }

    pub async fn make_game_invite_only(&self, game_id: i64, invite_token: &str) {
        sqlx::query("UPDATE games SET invite_only = true, invite_token = $2 WHERE id = $1")
            .bind(game_id)
            .bind(invite_token)
            .execute(&self.pool)
            .await
            .unwrap();
    }

    pub async fn join_game_as_spectator(&self, game_id: i64) -> reqwest::Response {
        self.client_spectator
            .post(format!("http://{}/api/games/{game_id}/join", self.addr))
            .header("Authorization", "Bearer test-spectator-api-token-99999")
            .json(&json!({}))
            .send()
            .await
            .unwrap()
    }

    pub async fn join_private_game_as_spectator(
        &self,
        game_id: i64,
        access_token: &str,
    ) -> reqwest::Response {
        self.client_spectator
            .post(format!("http://{}/api/games/{game_id}/join", self.addr))
            .header("Authorization", "Bearer test-spectator-api-token-99999")
            .json(&json!({"access_token": access_token}))
            .send()
            .await
            .unwrap()
    }

    pub async fn get_game_as_spectator(&self, game_id: i64) -> reqwest::Response {
        self.client_spectator
            .get(format!("http://{}/api/games/{game_id}", self.addr))
            .header("Authorization", "Bearer test-spectator-api-token-99999")
            .send()
            .await
            .unwrap()
    }

    pub async fn try_create_game_with(&self, opts: Value) -> reqwest::Response {
        let mut body = json!({ "cols": 9 });
        if let Some(obj) = opts.as_object() {
            for (k, v) in obj {
                body[k] = v.clone();
            }
        }
        if (body.get("komi").is_some()
            || body.get("handicap").is_some()
            || body.get("color").is_some())
            && body.get("invite_username").is_none()
            && body.get("invite_email").is_none()
        {
            body["invite_username"] = json!("test-white");
        }
        if (body.get("invite_username").is_some() || body.get("invite_email").is_some())
            && body["ranked"].as_bool() != Some(true)
        {
            if body.get("komi").is_none() {
                body["komi"] = json!(6.5);
            }
            if body.get("handicap").is_none() {
                body["handicap"] = json!(0);
            }
            if body.get("color").is_none() {
                body["color"] = json!("black");
            }
        }
        if body["ranked"].as_bool() == Some(true) && body.get("time_control").is_none() {
            body["time_control"] = json!("fischer");
            body["main_time_secs"] = json!(600);
            body["increment_secs"] = json!(5);
        }
        self.client_black
            .post(format!("http://{}/api/games", self.addr))
            .header("Authorization", "Bearer test-black-api-token-12345")
            .json(&body)
            .send()
            .await
            .unwrap()
    }

    pub async fn enter_territory_review(&self) -> i64 {
        let game_id = self.create_and_join().await;

        let resp = self
            .client_black
            .post(format!("http://{}/api/games/{game_id}/pass", self.addr))
            .header("Authorization", "Bearer test-black-api-token-12345")
            .send()
            .await
            .unwrap();
        assert!(
            resp.status().is_success(),
            "black pass failed: {}",
            resp.status()
        );

        let resp = self
            .client_white
            .post(format!("http://{}/api/games/{game_id}/pass", self.addr))
            .header("Authorization", "Bearer test-white-api-token-67890")
            .send()
            .await
            .unwrap();
        assert!(
            resp.status().is_success(),
            "white pass failed: {}",
            resp.status()
        );

        game_id
    }

    async fn ws_connect(&self, jar: &Arc<Jar>) -> WsClient {
        let url = format!("ws://{}/ws", self.addr);
        let request = tungstenite::http::Request::builder()
            .uri(&url)
            .header("Cookie", cookies_for(jar, &format!("http://{}", self.addr)))
            .header("Host", &self.addr)
            .header("Connection", "Upgrade")
            .header("Upgrade", "websocket")
            .header("Sec-WebSocket-Version", "13")
            .header(
                "Sec-WebSocket-Key",
                tungstenite::handshake::client::generate_key(),
            )
            .body(())
            .unwrap();

        let (stream, _) = tokio_tungstenite::connect_async(request).await.unwrap();
        let (sink, stream) = stream.split();
        WsClient { sink, stream }
    }
}

fn cookies_for(jar: &Jar, url: &str) -> String {
    let url = reqwest::Url::parse(url).unwrap();
    jar.cookies(&url)
        .and_then(|v| v.to_str().ok().map(ToOwned::to_owned))
        .unwrap_or_default()
}

pub struct WsClient {
    sink: futures_util::stream::SplitSink<
        tokio_tungstenite::WebSocketStream<
            tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
        >,
        tungstenite::Message,
    >,
    stream: futures_util::stream::SplitStream<
        tokio_tungstenite::WebSocketStream<
            tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
        >,
    >,
}

impl WsClient {
    pub fn from_parts(
        sink: futures_util::stream::SplitSink<
            tokio_tungstenite::WebSocketStream<
                tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
            >,
            tungstenite::Message,
        >,
        stream: futures_util::stream::SplitStream<
            tokio_tungstenite::WebSocketStream<
                tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
            >,
        >,
    ) -> Self {
        Self { sink, stream }
    }

    pub async fn send(&mut self, value: serde_json::Value) {
        self.sink
            .send(tungstenite::Message::Text(value.to_string().into()))
            .await
            .unwrap();
    }

    pub async fn recv(&mut self) -> serde_json::Value {
        self.recv_timeout(std::time::Duration::from_secs(5)).await
    }

    pub async fn recv_timeout(&mut self, timeout: std::time::Duration) -> serde_json::Value {
        let msg = tokio::time::timeout(timeout, self.stream.next())
            .await
            .expect("WS recv timed out")
            .expect("WS stream ended")
            .expect("WS recv error");

        match msg {
            tungstenite::Message::Text(text) => serde_json::from_str(&text).unwrap(),
            other => panic!("Expected text WS message, got: {other:?}"),
        }
    }

    pub async fn recv_kind(&mut self, kind: &str) -> serde_json::Value {
        let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(10);
        loop {
            let remaining = deadline - tokio::time::Instant::now();
            let msg = self.recv_timeout(remaining).await;
            if msg.get("kind").and_then(|k| k.as_str()) == Some(kind) {
                return msg;
            }
        }
    }

    pub async fn join_game(&mut self, game_id: i64) -> serde_json::Value {
        self.send(json!({"action": "join_game", "game_id": game_id}))
            .await;
        self.recv_kind("state_sync").await
    }

    pub async fn play(&mut self, game_id: i64, col: i32, row: i32) {
        self.send(json!({"action": "play", "game_id": game_id, "col": col, "row": row}))
            .await;
    }

    pub async fn pass(&mut self, game_id: i64) {
        self.send(json!({"action": "pass", "game_id": game_id}))
            .await;
    }

    pub async fn resign(&mut self, game_id: i64) {
        self.send(json!({"action": "resign", "game_id": game_id}))
            .await;
    }

    pub async fn abort(&mut self, game_id: i64) {
        self.send(json!({"action": "abort", "game_id": game_id}))
            .await;
    }

    pub async fn chat(&mut self, game_id: i64, text: &str) {
        self.send(json!({"action": "chat", "game_id": game_id, "message": text}))
            .await;
    }

    pub async fn request_undo(&mut self, game_id: i64) {
        self.send(json!({"action": "request_undo", "game_id": game_id}))
            .await;
    }

    pub async fn respond_undo(&mut self, game_id: i64, accept: bool) {
        let response = if accept { "accept" } else { "reject" };
        self.send(json!({"action": "respond_to_undo", "game_id": game_id, "response": response}))
            .await;
    }

    pub async fn toggle_chain(&mut self, game_id: i64, col: u8, row: u8) {
        self.send(json!({"action": "toggle_chain", "game_id": game_id, "col": col, "row": row}))
            .await;
    }

    pub async fn approve_territory(&mut self, game_id: i64) {
        self.send(json!({"action": "approve_territory", "game_id": game_id}))
            .await;
    }

    pub async fn claim_victory(&mut self, game_id: i64) {
        self.send(json!({"action": "claim_victory", "game_id": game_id}))
            .await;
    }

    pub async fn start_presentation(&mut self, game_id: i64) {
        self.send(json!({"action": "start_presentation", "game_id": game_id}))
            .await;
    }

    pub async fn end_presentation(&mut self, game_id: i64) {
        self.send(json!({"action": "end_presentation", "game_id": game_id}))
            .await;
    }

    pub async fn send_presentation_state(&mut self, game_id: i64, snapshot: &str) {
        self.send(
            json!({"action": "presentation_state", "game_id": game_id, "snapshot": snapshot}),
        )
        .await;
    }

    pub async fn give_control(&mut self, game_id: i64, target_user_id: i64) {
        self.send(
            json!({"action": "give_control", "game_id": game_id, "target_user_id": target_user_id}),
        )
        .await;
    }

    pub async fn take_control(&mut self, game_id: i64) {
        self.send(json!({"action": "take_control", "game_id": game_id}))
            .await;
    }

    pub async fn request_control(&mut self, game_id: i64) {
        self.send(json!({"action": "request_control", "game_id": game_id}))
            .await;
    }

    pub async fn cancel_control_request(&mut self, game_id: i64) {
        self.send(json!({"action": "cancel_control_request", "game_id": game_id}))
            .await;
    }

    pub async fn reject_control_request(&mut self, game_id: i64) {
        self.send(json!({"action": "reject_control_request", "game_id": game_id}))
            .await;
    }

    pub async fn close(self) {
        let mut sink = self.sink;
        let _ = sink.close().await;
    }
}

/// Lightweight in-process test server — calls the router directly via tower::ServiceExt
/// instead of spawning a TCP listener. For HTTP-only tests that don't need WebSocket.
pub struct LightServer {
    pub router: axum::Router,
    pub pool: SqlitePool,
    pub black_id: i64,
    pub white_id: i64,
    pub spectator_id: i64,
}

/// Response wrapper that mimics the parts of reqwest::Response used by tests.
pub struct LightResponse {
    status: axum::http::StatusCode,
    body: axum::body::Bytes,
}

impl LightResponse {
    pub fn status(&self) -> axum::http::StatusCode {
        self.status
    }

    pub async fn json<T: serde::de::DeserializeOwned>(self) -> Result<T, serde_json::Error> {
        serde_json::from_slice(&self.body)
    }

    pub async fn text(self) -> Result<String, std::string::FromUtf8Error> {
        String::from_utf8(self.body.to_vec())
    }
}

impl LightServer {
    pub async fn start() -> Self {
        let pool = create_test_db().await;

        let black_id: i64 =
            sqlx::query_scalar("SELECT id FROM users WHERE username = 'test-black'")
                .fetch_one(&pool)
                .await
                .unwrap();
        let white_id: i64 =
            sqlx::query_scalar("SELECT id FROM users WHERE username = 'test-white'")
                .fetch_one(&pool)
                .await
                .unwrap();
        let spectator_id: i64 =
            sqlx::query_scalar("SELECT id FROM users WHERE username = 'test-spectator'")
                .fetch_one(&pool)
                .await
                .unwrap();

        let presence = seki_web::ws::presence::UserPresence::with_grace_period(
            std::time::Duration::from_millis(0),
        );
        let (router, _state) = seki_web::build_router_with_registry_and_presence(
            pool.clone(),
            false,
            seki_web::ws::registry::GameRegistry::with_max_grace(100),
            presence,
            Some(session_signing_key()),
        )
        .await;

        LightServer {
            router,
            pool,
            black_id,
            white_id,
            spectator_id,
        }
    }

    pub async fn request(
        &self,
        method: axum::http::Method,
        path: &str,
        token: &str,
        body: Option<&serde_json::Value>,
    ) -> LightResponse {
        use tower::ServiceExt as _;

        let mut builder = axum::http::Request::builder()
            .method(&method)
            .uri(path)
            .header("Authorization", format!("Bearer {token}"));

        if body.is_some() {
            builder = builder.header("Content-Type", "application/json");
        }

        let body_bytes = body.map(|b| b.to_string()).unwrap_or_default().into_bytes();

        let mut req = builder.body(axum::body::Body::from(body_bytes)).unwrap();

        // tower_governor needs ConnectInfo to extract a client key.
        // In a real server, axum adds this from the TCP connection.
        req.extensions_mut()
            .insert(axum::extract::ConnectInfo(std::net::SocketAddr::from((
                [127, 0, 0, 1],
                0,
            ))));

        let resp = self.router.clone().oneshot(req).await.unwrap();
        let status = resp.status();
        let body = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap();

        LightResponse { status, body }
    }

    pub async fn create_game(&self) -> i64 {
        let resp = self
            .request(
                axum::http::Method::POST,
                "/api/games",
                "test-black-api-token-12345",
                Some(&json!({"cols": 9})),
            )
            .await;
        assert!(
            resp.status().is_success(),
            "create_game failed: {}",
            resp.status()
        );
        let body: Value = resp.json().await.unwrap();
        body["id"].as_i64().expect("game id missing from response")
    }

    pub async fn create_game_with(&self, opts: Value) -> i64 {
        let mut body = json!({"cols": 9});
        if let Some(obj) = opts.as_object() {
            for (k, v) in obj {
                body[k] = v.clone();
            }
        }
        if (body.get("komi").is_some()
            || body.get("handicap").is_some()
            || body.get("color").is_some())
            && body.get("invite_username").is_none()
            && body.get("invite_email").is_none()
        {
            body["invite_username"] = json!("test-white");
        }
        if (body.get("invite_username").is_some() || body.get("invite_email").is_some())
            && body["ranked"].as_bool() != Some(true)
        {
            if body.get("komi").is_none() {
                body["komi"] = json!(6.5);
            }
            if body.get("handicap").is_none() {
                body["handicap"] = json!(0);
            }
            if body.get("color").is_none() {
                body["color"] = json!("black");
            }
        }
        if body["ranked"].as_bool() == Some(true) && body.get("time_control").is_none() {
            body["time_control"] = json!("fischer");
            body["main_time_secs"] = json!(600);
            body["increment_secs"] = json!(5);
        }
        let resp = self
            .request(
                axum::http::Method::POST,
                "/api/games",
                "test-black-api-token-12345",
                Some(&body),
            )
            .await;
        assert!(
            resp.status().is_success(),
            "create_game_with failed: {}",
            resp.status()
        );
        let body: Value = resp.json().await.unwrap();
        body["id"].as_i64().expect("game id missing from response")
    }

    pub async fn join_game(&self, game_id: i64) -> Value {
        let resp = self
            .request(
                axum::http::Method::POST,
                &format!("/api/games/{game_id}/join"),
                "test-white-api-token-67890",
                Some(&json!({})),
            )
            .await;
        assert!(
            resp.status().is_success(),
            "join_game failed: {}",
            resp.status()
        );
        let body = resp.json().await.unwrap();
        self.finalize_pregame_settings_if_present(game_id).await;
        body
    }

    pub async fn create_and_join(&self) -> i64 {
        let game_id = self.create_game().await;
        self.join_game(game_id).await;
        game_id
    }

    pub async fn create_and_join_with(&self, opts: Value) -> i64 {
        let game_id = self.create_game_with(opts).await;
        self.join_game(game_id).await;
        game_id
    }

    async fn finalize_pregame_settings_if_present(&self, game_id: i64) {
        let Some((handicap, komi, color)): Option<(i32, f64, String)> = sqlx::query_as(
            "SELECT handicap, komi, color FROM pregame_setting_negotiations WHERE game_id = $1",
        )
        .bind(game_id)
        .fetch_optional(&self.pool)
        .await
        .unwrap() else {
            return;
        };

        let (creator_id, opponent_id): (Option<i64>, Option<i64>) =
            sqlx::query_as("SELECT creator_id, opponent_id FROM games WHERE id = $1")
                .bind(game_id)
                .fetch_one(&self.pool)
                .await
                .unwrap();
        let creator_id = creator_id.unwrap();
        let opponent_id = opponent_id.unwrap();
        let (final_black, final_white) = if color == "white" {
            (opponent_id, creator_id)
        } else {
            (creator_id, opponent_id)
        };
        let stage = if handicap >= 2 {
            "white_to_play"
        } else {
            "black_to_play"
        };

        let mut tx = self.pool.begin().await.unwrap();
        sqlx::query(
            "UPDATE games SET handicap = $2, komi = $3, black_id = $4, white_id = $5, \
             nigiri = false, stage = $6, cached_engine_state = NULL, updated_at = CURRENT_TIMESTAMP \
             WHERE id = $1",
        )
        .bind(game_id)
        .bind(handicap)
        .bind(komi)
        .bind(final_black)
        .bind(final_white)
        .bind(stage)
        .execute(&mut *tx)
        .await
        .unwrap();
        sqlx::query("DELETE FROM pregame_setting_negotiations WHERE game_id = $1")
            .bind(game_id)
            .execute(&mut *tx)
            .await
            .unwrap();
        tx.commit().await.unwrap();
    }
}

pub async fn api_error_message(resp: reqwest::Response) -> String {
    let body: Value = resp.json().await.unwrap();
    body["error"]["message"].as_str().unwrap().to_string()
}
