# General Guidelines

## Grug Brain Development

Always apply the grug brain philosophy to software development: fight complexity, prefer simplicity, and build maintainable code that future developers can understand.

## Collaborative Behavior

- Always start with a short plan before editing.
- Ask before large refactors or new dependencies.
- After changes, run relevant tests if available.
- Explain what changed in plain language.
- Be concise and act like a collaborative pair programmer.

## Patterns and Conventions

- Prefer functional, stateless functions for most things; avoid side-effects and globally shared mutating variables
- Prefer declarative interfaces and imperative implementation
- Prefer minimal diffs.
- In general, don't test log output
- When a function starts taking too many parameters (>4), consider passing an object instead.
- Avoid pulling in outside dependencies for trivial features
- When considering adding a new dependency, always consider that library's own dependency tree. Prefer libraries with less dependencies.
- When completing a feature, update any associated documentation (README checklist, closing github issues, etc)
- Conventional commit messages, single-line unless verbose explanation warranted
- Always commit directly to main, no need for feature branches and PRs

# This Codebase

## Specifications

The following sources outline the target state of the application:

- README.md: includes a high-level feature checklist. Checked items have already been implemented.
- FRONTEND_SPEC.md: defines the expected behavior of the frontend application
- API_SPEC.md: defines the expected behavior of the web/ws API
- GitHub issues: should broadly align with unimplemented spec items, readme features or outstanding bugs.

## Build & Test Commands

```bash
# Rust (workspace root)
cargo build                          # build all crates
cargo test --all                     # run the Rust test suite
cargo test -p go-engine              # engine tests only
cargo test -p go-engine -- ko        # run tests matching "ko"
cargo check --all                    # type-check without building

# WASM (from repo root)
wasm-pack build go-engine-wasm --target web --out-dir seki-web/static/wasm

# Frontend (seki-web/frontend/)
pnpm install                         # install deps
pnpm run build                       # esbuild: src/index.ts → ../static/dist/bundle.js
pnpm run build:wasm                  # build WASM engine
pnpm run dev                         # watch mode
pnpm run typecheck                   # tsc --noEmit
pnpm test                            # run Vitest tests

# Docker
docker compose up                    # postgres + web service on :3000
```

## Architecture

Cargo workspace with three crates:

### go-engine

Pure game logic library. No IO, no async. Clone-on-write board state — `Goban::play()`/`pass()` return a new `Goban` rather than mutating. Key types: `Engine`, `Goban`, `Stone` (Black=1, White=-1), `Turn`, `Stage`. Also includes an SGF parser/serializer (`go_engine::sgf`), game tree, replay navigation, and territory scoring.

### go-engine-wasm

Thin wasm-bindgen shell over `go-engine`. Only handles WASM-boundary concerns (js_sys types, JSON serialization, primitive conversions). All real logic belongs in `go-engine` so it's testable without WASM and reusable server-side.

### seki-web

Axum 0.8 web app. Modules follow a clean separation:

- `models/` = sqlx-backed database access and row types
- `services/` = business logic, engine building, clocks, lobby data, game creation/join flows, move/chat/undo/territory actions
- `routes/` = HTTP handlers for API, auth, settings, users, and SPA shell delivery
- `ws/` = live websocket endpoint, room registry, per-game channels, presence tracking
- `templates/` = small Askama layer for the SPA shell and shared serialized user data

**Request flow:** Axum router → route handler → service layer → model → DB. The HTML layer is intentionally thin: most page routes serve a single Askama SPA shell, then the Preact frontend bootstraps from `window.__sekiBootstrap` and `/api/web/*` JSON endpoints.

**Frontend modules** (`seki-web/frontend/src/`): `index.ts` mounts `app.tsx`. Current directories are:

- `game/` — live game state, websocket message handling, access/capability checks, clocks, notifications, unread tracking, UI helpers
- `goban/` — board rendering and WASM bridge, including `create-board.tsx`
- `components/` — reusable Preact UI such as chat, controls, player panels, menus, game info, notification settings
- `layouts/` — page-level screens and orchestration for games list, live game, analysis, game settings, user pages
- `utils/` — stateless browser helpers for formatting, SPA navigation, flash messages, preferences, theme, storage, SGF, etc.
- `__tests__/` — Vitest coverage for frontend utilities and state logic

**Routing model:** browser routes like `/games`, `/games/:id`, `/analysis`, `/users/:username`, `/login`, `/register`, and `/settings` all serve the SPA shell. Route-specific JSON lives under `/api/web/*`. Programmatic API routes live under `/api/*`.

**Real-time:** A single WebSocket endpoint (`/ws`) handles all real-time communication. Clients subscribe to game rooms and receive lobby updates through a broadcast channel. `GameRegistry` manages per-game engine/channel state. Presence is tracked separately through `presence.rs` and `presence_subscriptions.rs`.

**Auth (web):** tower-sessions with PostgreSQL-backed session storage. `CurrentUser` auto-creates an anonymous user when no session token exists, then upgrades that user in place on registration.

**Auth (API):** Bearer token authentication. `ApiUser` extractor reads `Authorization: Bearer <token>` header, looks up by `api_token` column, requires a registered account, returns 401 JSON on failure. Tokens are managed from the `/settings` web page.

**API routes**:

- `/api/*` = public/programmatic JSON API plus authenticated game actions
- `/api/web/*` = SPA bootstrap/data endpoints for first-party web screens
- session-based auth routes (`/login`, `/register`, `/logout`) are web-only, not bearer-token API flows

## Database

PostgreSQL via sqlx 0.8. Migrations live in `seki-web/migrations/` as numbered files (001, 002, …). **Never modify existing migration files** — always create new numbered migrations. Migrations run at app startup.

Core tables: `users`, `games`, `turns`, `messages`, `territory_reviews`, plus the session store tables managed by `tower-sessions-sqlx-store`.

Important persisted fields beyond the obvious basics:

- `games` stores clock state directly (`clock_black_ms`, `clock_white_ms`, `clock_black_periods`, `clock_white_periods`, `clock_active_stone`, `clock_last_move_at`, `clock_expires_at`)
- `games` also stores challenge/privacy/lobby state (`access_token`, `invite_token`, `is_private`, `invite_only`, `open_to`, `nigiri`, `territory_review_expires_at`)
- `turns` stores optional clock snapshots per move
- `users.preferences` is JSON and drives frontend settings like theme/notifications

## Environment Variables

- `DATABASE_URL` — postgres connection string (default: `postgres://seki:seki@localhost:5432/seki`)
- `PORT` — HTTP port (default: 3000)
- `ENVIRONMENT` — set to `production` for secure cookies
- `STATIC_DIR` — static file path (Docker sets `/app/static`)
- `BASE_URL` — base origin used in invitation links
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USERNAME`, `SMTP_PASSWORD`, `SMTP_FROM` — optional mailer configuration for invite emails

## Key Dependency Versions

axum 0.8, tower-sessions 0.14 (must use 0.14+ for axum-core 0.5 compat), tower-sessions-sqlx-store 0.15, sqlx 0.8 (postgres), askama 0.15, Rust edition 2024, Node 24, pnpm, Preact 10, esbuild 0.24, wasm-bindgen 0.2, js-sys 0.3.

## Naming: User vs Player

- **User** = account/identity (`User` model in `models/user.rs`, `users` DB table, `CurrentUser`/`ApiUser` extractors, `UserData` template type)
- **Player** = game participant (`GameWithPlayers`, `has_player()`, `player_stone()`, `player_id` in services and websocket/game actions)

## App Conventions

- Minimum handicap = 2 stones
- `Engine::is_legal(point, stone)` takes `Stone` directly, not `Option<Stone>`
- GameState serialization: `{"board": [i8], "cols": u8, "rows": u8, "captures": {"black": n, "white": n}, "ko": {"pos": [i8,i8], "illegal": i8}}`
- TypeScript: prefer `type` over `interface`, never use `as unknown as`
- Keep new logic in `go-engine` or Rust services when possible; keep `go-engine-wasm` thin
- Do not add server-rendered page-specific templates unless there is a strong reason; the current app shape is SPA shell + JSON bootstrap
