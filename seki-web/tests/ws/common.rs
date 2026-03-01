#![allow(dead_code)]

use std::sync::Arc;
use std::time::Duration;

use argon2::password_hash::SaltString;
use argon2::password_hash::rand_core::OsRng;
use argon2::{Argon2, PasswordHasher};
use futures_util::{SinkExt, StreamExt};
use reqwest::cookie::{CookieStore, Jar};
use serde_json::{Value, json};
use sqlx::PgPool;
use testcontainers::runners::AsyncRunner;
use testcontainers_modules::postgres::Postgres;
use tokio::net::TcpListener;
use tokio_tungstenite::tungstenite;

/// A running test server with two pre-authenticated users.
pub struct TestServer {
    pub addr: String,
    pub pool: PgPool,
    pub black_id: i64,
    pub white_id: i64,
    pub client_black: reqwest::Client,
    pub client_white: reqwest::Client,
    jar_black: Arc<Jar>,
    jar_white: Arc<Jar>,
    // Keep the container alive for the lifetime of the test
    _container: testcontainers::ContainerAsync<Postgres>,
}

impl TestServer {
    pub async fn start() -> Self {
        // Start ephemeral Postgres via testcontainers
        let container = Postgres::default().start().await.unwrap();
        let host = container.get_host().await.unwrap();
        let port = container.get_host_port_ipv4(5432).await.unwrap();
        let database_url = format!("postgres://postgres:postgres@{host}:{port}/postgres");

        let pool = sqlx::PgPool::connect(&database_url).await.unwrap();

        // Run app migrations
        seki_web::db::run_migrations(&pool).await.unwrap();

        // Hash a test password with argon2
        let salt = SaltString::generate(&mut OsRng);
        let password_hash = Argon2::default()
            .hash_password(b"testpassword", &salt)
            .unwrap()
            .to_string();

        // Insert two registered users directly
        let black_id: i64 = sqlx::query_scalar(
            "INSERT INTO users (session_token, username, password_hash, api_token) \
             VALUES ($1, $2, $3, $4) RETURNING id",
        )
        .bind("black-session-token")
        .bind("test-black")
        .bind(&password_hash)
        .bind("test-black-api-token-12345")
        .fetch_one(&pool)
        .await
        .unwrap();

        let white_id: i64 = sqlx::query_scalar(
            "INSERT INTO users (session_token, username, password_hash, api_token) \
             VALUES ($1, $2, $3, $4) RETURNING id",
        )
        .bind("white-session-token")
        .bind("test-white")
        .bind(&password_hash)
        .bind("test-white-api-token-67890")
        .fetch_one(&pool)
        .await
        .unwrap();

        // Build and spawn the server (zero grace period for instant disconnect in tests)
        let presence =
            seki_web::ws::presence::UserPresence::with_grace_period(Duration::from_millis(0));
        let (router, _state) =
            seki_web::build_router_with_presence(pool.clone(), false, presence).await;
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap().to_string();

        tokio::spawn(async move {
            use axum::extract::Request;
            use tower::Layer as _;
            use tower_http::normalize_path::NormalizePathLayer;

            let app = NormalizePathLayer::trim_trailing_slash().layer(router);
            axum::serve(
                listener,
                axum::ServiceExt::<Request>::into_make_service(app),
            )
            .await
            .unwrap();
        });

        // Build reqwest clients with cookie stores and log them in
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

        let base = format!("http://{addr}");

        // Log in black user:
        // 1. GET /login to create an anonymous session and get the session cookie
        client_black
            .get(format!("{base}/login"))
            .send()
            .await
            .unwrap();
        // 2. POST /login with credentials to switch session to the registered user
        client_black
            .post(format!("{base}/login"))
            .form(&[("username", "test-black"), ("password", "testpassword")])
            .send()
            .await
            .unwrap();

        // Log in white user
        client_white
            .get(format!("{base}/login"))
            .send()
            .await
            .unwrap();
        client_white
            .post(format!("{base}/login"))
            .form(&[("username", "test-white"), ("password", "testpassword")])
            .send()
            .await
            .unwrap();

        TestServer {
            addr,
            pool,
            black_id,
            white_id,
            client_black,
            client_white,
            jar_black,
            jar_white,
            _container: container,
        }
    }

    /// Create a 9x9 game via the API (black is creator, plays black).
    pub async fn create_game(&self) -> i64 {
        let resp = self
            .client_black
            .post(format!("http://{}/api/games", self.addr))
            .header("Authorization", "Bearer test-black-api-token-12345")
            .json(&json!({
                "cols": 9,
                "rows": 9,
                "color": "black",
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

    /// Have the white user join an existing game via the API.
    pub async fn join_game(&self, game_id: i64) -> Value {
        let resp = self
            .client_white
            .post(format!("http://{}/api/games/{game_id}/join", self.addr))
            .header("Authorization", "Bearer test-white-api-token-67890")
            .send()
            .await
            .unwrap();
        assert!(
            resp.status().is_success(),
            "join_game failed: {}",
            resp.status()
        );
        resp.json().await.unwrap()
    }

    /// Create a game with custom settings via the API.
    pub async fn create_game_with(&self, opts: Value) -> i64 {
        let mut body = json!({"cols": 9, "rows": 9, "color": "black"});
        if let Some(obj) = opts.as_object() {
            for (k, v) in obj {
                body[k] = v.clone();
            }
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

    /// Create a game and have white join it. Returns the game id.
    pub async fn create_and_join(&self) -> i64 {
        let game_id = self.create_game().await;
        self.join_game(game_id).await;
        game_id
    }

    /// Create a game with custom settings and have white join. Returns game id.
    pub async fn create_and_join_with(&self, opts: Value) -> i64 {
        let game_id = self.create_game_with(opts).await;
        self.join_game(game_id).await;
        game_id
    }

    /// Open a WebSocket connection authenticated as the black user.
    pub async fn ws_black(&self) -> WsClient {
        self.ws_connect(&self.jar_black).await
    }

    /// Open a WebSocket connection authenticated as the white user.
    pub async fn ws_white(&self) -> WsClient {
        self.ws_connect(&self.jar_white).await
    }

    async fn ws_connect(&self, jar: &Arc<Jar>) -> WsClient {
        let url = format!("ws://{}/ws", self.addr);
        let req_url = reqwest::Url::parse(&format!("http://{}", self.addr)).unwrap();

        // Extract cookies from the jar for this domain
        let cookie_header = jar
            .cookies(&req_url)
            .map(|c| c.to_str().unwrap().to_string())
            .unwrap_or_default();

        let request = tungstenite::http::Request::builder()
            .uri(&url)
            .header("Cookie", cookie_header)
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

        let (stream, _response) = tokio_tungstenite::connect_async(request)
            .await
            .expect("WebSocket connect failed");

        let (sink, stream) = stream.split();
        WsClient { sink, stream }
    }
}

/// A WebSocket client wrapping a split tokio-tungstenite connection.
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
    /// Create a WsClient from pre-split sink and stream (for custom auth scenarios).
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
        WsClient { sink, stream }
    }

    /// Send a JSON message.
    pub async fn send(&mut self, msg: Value) {
        self.sink
            .send(tungstenite::Message::Text(msg.to_string().into()))
            .await
            .expect("WS send failed");
    }

    /// Receive the next text message as JSON (5s timeout).
    pub async fn recv(&mut self) -> Value {
        self.recv_timeout(Duration::from_secs(5)).await
    }

    /// Receive with a custom timeout.
    pub async fn recv_timeout(&mut self, timeout: Duration) -> Value {
        let msg = tokio::time::timeout(timeout, self.stream.next())
            .await
            .expect("WS recv timed out")
            .expect("WS stream ended")
            .expect("WS recv error");

        match msg {
            tungstenite::Message::Text(text) => {
                serde_json::from_str(&text).expect("WS message not valid JSON")
            }
            other => panic!("Expected text WS message, got: {other:?}"),
        }
    }

    /// Skip messages until one has a matching `kind` field. Returns that message.
    pub async fn recv_kind(&mut self, kind: &str) -> Value {
        let deadline = tokio::time::Instant::now() + Duration::from_secs(10);
        loop {
            let remaining = deadline - tokio::time::Instant::now();
            let msg = self.recv_timeout(remaining).await;
            if msg.get("kind").and_then(|k| k.as_str()) == Some(kind) {
                return msg;
            }
        }
    }

    // -- Game action helpers --
    // These only SEND the message. Tests must recv and assert responses themselves,
    // since different actions produce different message kinds, and the other player
    // also needs to consume their own broadcasts.

    /// Send join_game and wait for the initial `state` response.
    pub async fn join_game(&mut self, game_id: i64) -> Value {
        self.send(json!({"action": "join_game", "game_id": game_id}))
            .await;
        self.recv_kind("state").await
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

    pub async fn disconnect_abort(&mut self, game_id: i64) {
        self.send(json!({"action": "disconnect_abort", "game_id": game_id}))
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
        self.send(json!({"action": "presentation_state", "game_id": game_id, "snapshot": snapshot}))
            .await;
    }

    pub async fn give_control(&mut self, game_id: i64, target_user_id: i64) {
        self.send(json!({"action": "give_control", "game_id": game_id, "target_user_id": target_user_id}))
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

    /// Close the WebSocket connection (simulates browser close / disconnect).
    pub async fn close(self) {
        let mut sink = self.sink;
        let _ = sink.close().await;
    }
}
