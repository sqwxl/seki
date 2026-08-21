# This Codebase

## Specifications

The following sources outline the target state of the application:

- README.md: includes a high-level feature checklist. Checked items have already been implemented.
- FRONTEND_SPEC.md: defines the expected behavior of the frontend application
- API_SPEC.md: defines the expected behavior of the web/ws API
- GitHub issues: should broadly align with unimplemented spec items, readme features or outstanding bugs.

## Build & Test Commands

Primary workflow uses `just` (see `justfile` for all recipes):

```bash
just setup                          # install deps (wasm-pack, watchexec, pnpm, lefthook)
just run                            # parallel: wasm-hot + serve-hot + frontend-hot
just katago                         # run GTP bridge
just random-bots                    # run QA bots
just deploy                         # runs cargo test --all -j 4, then deploy-prebuilt.sh (migration check against a prod DB copy, ARM build, upload, verify)
```

Note: the dev server runs on **port 3333** (not the default 3000).

> **Resource constraints:** the dev machine has 16 cores but only 14GB RAM
> (+ 8GB zram swap). Rust builds run one `rustc` per core by default, so
> heavy compiles (`cargo clippy --all-targets`, workspace-wide tests) can
> OOM and freeze the desktop. Mitigations (already applied to `justfile`
> and lefthook):
> - Run one cargo command at a time; verify it completes before the next.
> - Cap jobs on heavy builds: `cargo test --all -j 4`, `cargo clippy --all-targets -j 4`.
> - Prefer `cargo check -p seki-web` for quick verification; run the full
>   ws test suite (`cargo test -p seki-web --test ws -j 4`) when needed.
> - Check `free -h` before big builds.

Direct commands:

```bash
# Rust (workspace root)
cargo build --all                    # build all crates
cargo test --all                     # run the Rust test suite
cargo test -p go-engine              # engine tests only
cargo test -p go-engine -- ko        # run tests matching "ko"
cargo test -p seki-web               # web server tests
cargo check --all                    # type-check without building

# WASM (from repo root)
wasm-pack build go-engine-wasm --target web --out-dir seki-web/static/wasm

# Frontend (seki-web/frontend/)
pnpm install                         # install deps
pnpm run build                       # build.mjs: bundle JS/CSS → ../static/dist/
pnpm run build:wasm                  # build WASM engine
pnpm run dev                         # watch mode (build.mjs --watch)
pnpm run typecheck                   # tsc --noEmit
pnpm test                            # Vitest tests

# Docker
docker compose up                    # sqlite-backed web service + mailpit on :3000
```

Pre-commit hooks (lefthook): `cargo test -p go-engine`, `cargo test -p seki-web`, `pnpm test` (frontend), `cargo fmt`, `cargo clippy -- -D warnings`, `prettier`, `organize-imports`.

## Test Output Efficiency

Running the full test suite is expensive (~50s). When you need to inspect test
output, **write it to a temp file and search that** instead of re-running
`cargo test` with different `grep`/`rg` predicates:

```bash
cargo test -p seki-web &> /tmp/test-output.txt
rg "FAILED" /tmp/test-output.txt
rg "panicked" /tmp/test-output.txt
```

This saves repeated compilation and test execution.

## Architecture

Cargo workspace with seven crates:

### go-engine

Pure game logic library. No IO, no async. Copy-on-write board state — `Goban::play()`/`pass()` return a new `Goban` rather than mutating. Key types: `Engine`, `Goban`, `Stone` (Black=1, White=-1), `Turn`, `Stage`. Also includes an SGF parser/serializer (`go_engine::sgf`), game tree, replay navigation, and territory scoring.

### go-engine-wasm

Thin wasm-bindgen shell over `go-engine`. Only handles WASM-boundary concerns (js_sys types, JSON serialization, primitive conversions). All real logic belongs in `go-engine` so it's testable without WASM and reusable server-side.

### seki-api

Shared API types crate. Defines `game::GameSettings`, `game::InGameClock`, `game::Negotiations`, `user::UserData`/`RankDto`/`RankStatus`, and `ws::ClientMsg`/`ServerMsg` enums for WebSocket protocol. Used by both `seki-web` and `seki-client`. Optional `openapi` feature adds `utoipa::ToSchema` derives.

### seki-client

Async HTTP + WebSocket client library. Uses `reqwest` for REST calls and `tokio-tungstenite` for WebSocket. Depends on `seki-api` for shared types.

### seki-gtp

Bridge binary that connects GTP engines (e.g., KataGo) to Seki. Reads engine config from a TOML file (`gtp.toml` by default). Spawns GTP subprocesses, relays moves, and reports results.

### seki-random-bots

QA/testing binary that simulates an active user pool. Creates accounts, joins/open games, plays random legal moves. Config via `random-bots.toml`.

### seki-android

Android client in `seki-android/` (not a Cargo workspace member). Kotlin, WebView-based. Wraps the Seki web app in a native Android shell with Firebase Cloud Messaging for push notifications. Built with Gradle.

### seki-web

Axum 0.8 web app. Top-level modules:

- `db.rs` — pool creation and migration runner
- `error.rs` — `AppError` enum with structured JSON error responses
- `session.rs` — `CurrentUser` extractor (anon auto-create, upgrade on registration)
- `models/` — sqlx-backed database access and row types (user, game, turn, message, rating, app_credential, fcm_token, push_destination, vapid_config, pregame_settings, game_read)
- `services/` — business logic: clock, clock_sweep, engine_builder, fcm, game_access, game_actions/*, game_creator, game_joiner, jwt, live, mailer, presentation_actions, push, rating/*, state_assembly, state_serializer
- `routes/` — HTTP handlers: `api/` (programmatic REST + game actions), `web_api/` (SPA bootstrap), plus auth, fcm, flash, games, health, push, reload, settings, spa, users
- `ws/` — WebSocket endpoint: game_channel, live (lobby broadcast), registry, presence, presence_subscriptions, registry_cleanup
- `views/` — Askama view structs for the SPA shell (`shell.rs`, `games_show.rs`)

**Request flow:** Axum router → route handler → service layer → model → DB. The HTML layer is thin: most routes serve the SPA shell via `views/shell.rs`, then the Preact frontend bootstraps from `window.__sekiBootstrap` and `/api/web/*` JSON endpoints. Askama templates live in `templates/` (only `base.html` and `spa_shell.html`).

**Frontend modules** (`seki-web/frontend/src/`): `index.ts` mounts `app.tsx`. Current directories:

- `spa/` — SPA routing, screen state management, route data loaders, auth/game/profile screens
- `game/` — live game state, websocket message handling, access/capability checks, clocks, notifications, unread tracking, UI helpers
- `goban/` — board rendering and WASM bridge, including `create-board.tsx`
- `components/` — reusable Preact UI such as chat, controls, player panels, menus, game info, notification settings
- `layouts/` — page-level screens and orchestration for games list, live game, analysis, game settings, user pages
- `utils/` — stateless browser helpers for formatting, SPA navigation, flash messages, preferences, theme, storage, SGF, etc.
- `native/` — native app bridge (`SekiBridge`) for FCM tokens, push events, lifecycle events
- `__tests__/` — Vitest coverage for frontend utilities and state logic
- Top-level: `push.ts` (web push subscription), `service-worker.ts`, `ws.ts` (WebSocket client)

**Routing model:** browser routes like `/games`, `/games/:id`, `/analysis`, `/users/:username`, `/login`, `/register`, and `/settings` all serve the SPA shell. Route-specific JSON lives under `/api/web/*`. Programmatic API routes live under `/api/*`.

**Real-time:** A single WebSocket endpoint (`/ws`) handles all real-time communication. Clients subscribe to game rooms and receive lobby updates through a broadcast channel. `GameRegistry` manages per-game engine/channel state. Presence is tracked separately through `presence.rs` and `presence_subscriptions.rs`.

**Auth (web):** tower-sessions with SQLite-backed session storage. `CurrentUser` auto-creates an anonymous user when no session token exists, then upgrades that user in place on registration.

**Auth (API):** Bearer token authentication. `ApiUser` extractor reads `Authorization: Bearer <token>` header, looks up by `api_token` column, requires a registered account, returns 401 JSON on failure. Tokens are managed from the `/settings` web page.

**App credentials:** opaque refresh tokens for PWA identity persistence (`app_credential` model). Stored as sha256 like all other tokens; rotated on restore, revoked on logout, 90-day rolling expiry.

**Push notifications:** Web Push (VAPID) for browsers, FCM for native apps. Tokens stored in `fcm_tokens` and `push_destinations` tables.

**API routes**:

- `/api/*` = public/programmatic JSON API plus authenticated game actions (REST + OpenAPI docs via Scalar at `/api/docs`)
- `/api/web/*` = SPA bootstrap/data endpoints for first-party web screens
- session-based auth routes (`/login`, `/register`, `/logout`) are web-only, not bearer-token API flows

## Database

SQLite via sqlx 0.8. Migrations live in `seki-web/migrations/` as numbered files (001 through 010). **Never modify existing migration files** — always create new numbered migrations. Migrations run at app startup.

Core tables: `users`, `games`, `turns`, `messages`, `territory_reviews`, `player_ratings`, `app_credentials`, `fcm_tokens`, `push_destinations`, `vapid_configs`, plus the session store tables managed by `tower-sessions-sqlx-store`.

Important persisted fields beyond the obvious basics:

- `games` stores clock state directly (`clock_black_ms`, `clock_white_ms`, `clock_black_periods`, `clock_white_periods`, `clock_active_stone`, `clock_last_move_at`, `clock_expires_at`)
- `games` also stores challenge/privacy/lobby state (`access_token`, `invite_token`, `is_private`, `invite_only`, `open_to`, `nigiri`, `territory_review_expires_at`, `is_ranked`)
- `turns` stores optional clock snapshots per move
- `users.preferences` is JSON and drives frontend settings like theme/notifications
- `player_ratings` stores Glicko-2 (rating, deviation, volatility) per player per game

## Environment Variables

- `DATABASE_URL` — SQLite connection string (default: `sqlite://seki.db`)
- `PORT` — HTTP port (default: 3000)
- `ENVIRONMENT` — set to `production` for secure cookies
- `STATIC_DIR` — static file path (Docker sets `/app/static`)
- `BASE_URL` — base origin used in invitation links
- `SESSION_SECRET` — session cookie signing/encryption key; keeps browser sessions valid across restarts (auto-generated per boot if unset)
- `RELEASE_ID` — version string for health endpoint (default: `"unknown"`)
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USERNAME`, `SMTP_PASSWORD`, `SMTP_FROM` — optional mailer configuration for invite emails
- `VAPID_PRIVATE_KEY`, `VAPID_PUBLIC_KEY`, `VAPID_SUBJECT` — optional Web Push VAPID keys
- `FCM_SERVER_KEY` — optional Firebase Cloud Messaging server key for native push

## Key Dependency Versions

axum 0.8, tower-sessions 0.14 (must use 0.14+ for axum-core 0.5 compat), tower-sessions-sqlx-store 0.15, sqlx 0.8 (sqlite), askama 0.15, utoipa 5 (OpenAPI), utoipa-scalar 0.3 (docs UI), tower_governor 0.8 (rate limiting), skillratings 0.29 (Glicko-2), argon2 0.5, lettre 0.11 (email), web-push 0.11, Rust edition 2024, Node 24, pnpm, Preact ~10.29.2, @preact/signals ^1.3, esbuild ^0.27, TypeScript 5.x, Vitest ^4, Vite 8, wasm-bindgen 0.2, js-sys 0.3.

## Naming: User vs Player

- **User** = account/identity (`User` model in `models/user.rs`, `users` DB table, `CurrentUser`/`ApiUser` extractors, `UserData` view type)
- **Player** = game participant (`GameWithPlayers`, `has_player()`, `player_stone()`, `player_id` in services and websocket/game actions)

## App Conventions

- Minimum handicap = 2 stones
- `Engine::is_legal(point, stone)` takes `Stone` directly, not `Option<Stone>`
- GameState serialization: `{"board": [i8], "cols": u8, "rows": u8, "captures": {"black": n, "white": n}, "ko": {"pos": [i8,i8], "illegal": i8}}`
- TypeScript: prefer `type` over `interface`, never use `as unknown as`
- Keep new logic in `go-engine` or Rust services when possible; keep `go-engine-wasm` thin
- Do not add server-rendered page-specific templates unless there is a strong reason; the current app shape is SPA shell + JSON bootstrap
- Shared API types (game settings, user data, WS messages) belong in `seki-api`, not duplicated between server and client

## Commits & Deploys

- **Never commit, push, or deploy without explicit instruction from the user.** An earlier "sure" or "go ahead" covers only the change it was said about, not later ones. Always stop and ask before each commit, push, or deploy.
- A deployment is a separate step from a commit/push — asking about one is not asking about the other.
- When a deploy is interrupted or aborted, report the exact state (what is pushed vs what is live) and wait for instruction before retrying.
