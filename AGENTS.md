# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Test Commands

```bash
# Rust (workspace root)
cargo build                          # build all crates
cargo test --all                     # run all tests (166 tests, mostly in go-engine)
cargo test -p go-engine              # engine tests only
cargo test -p go-engine -- ko        # run tests matching "ko"
cargo check --all                    # type-check without building

# WASM (from repo root)
wasm-pack build go-engine-wasm --target web --out-dir seki-web/static/wasm

# Frontend (seki-web/frontend/)
pnpm install                         # install deps
pnpm run build                       # esbuild: src/go.tsx → ../static/dist/bundle.js
pnpm run build:wasm                  # build WASM engine
pnpm run dev                         # watch mode
pnpm run typecheck                   # tsc --noEmit

# Docker
docker-compose up                    # postgres + web service on :3000
```

## Architecture

Cargo workspace with three crates:

### go-engine
Pure game logic library. No IO, no async. Clone-on-write board state — `Goban::play()`/`pass()` return a new `Goban` rather than mutating. Key types: `Engine`, `Goban`, `Stone` (Black=1, White=-1), `Turn`, `Stage`. Also includes an SGF parser/serializer (`go_engine::sgf`), game tree, replay navigation, and territory scoring.

### go-engine-wasm
Thin wasm-bindgen shell over `go-engine`. Only handles WASM-boundary concerns (js_sys types, JSON serialization, primitive conversions). All real logic belongs in `go-engine` so it's testable without WASM and reusable server-side.

### seki-web
Axum 0.8 web app. Modules follow a clean separation: `models/` (sqlx queries), `services/` (engine building, game creation, state serialization), `routes/` (HTTP handlers), `ws/` (WebSocket game channels), `templates/` (Askama template structs).

**Request flow:** Axum router → route handler → service layer → model (sqlx) → DB. Templates render server-side HTML. The game board UI is a Preact app (`seki-web/frontend/`) bundled with esbuild, loaded on the game show page.

**Real-time:** A single WebSocket endpoint (`/ws`) handles all real-time communication. Clients subscribe to game rooms via `join_game`/`leave_game` messages, and receive lobby events (game list updates) via a broadcast channel. `GameRegistry` manages per-game rooms; on join, server sends full game state, and subsequent moves are broadcast to all connected players.

**Auth (web):** tower-sessions with PostgreSQL store. `CurrentPlayer` extractor auto-creates anonymous players (random session token) if no session exists. Registration adds email/username/password (Argon2).

**Auth (API):** Bearer token authentication. `ApiPlayer` extractor reads `Authorization: Bearer <token>` header, looks up by `api_token` column, requires a registered account, returns 401 JSON on failure. Tokens are managed from the `/settings` web page.

**API routes** (`/api/*`): JSON endpoints for programmatic access. Authenticated endpoints use `ApiPlayer`; public endpoints (list games, get game, get messages, get turns) are unauthenticated. Session-based auth concepts (login, register, logout) are not part of the API — those are web-only routes.

## Database

PostgreSQL via sqlx 0.8. Migrations live in `seki-web/migrations/` as numbered files (001, 002, …). **Never modify existing migration files** — always create new numbered migrations. Migrations run at app startup.

Tables: `players`, `games`, `turns`, `messages`, `territory_reviews`.

## Environment Variables

- `DATABASE_URL` — postgres connection string (default: `postgres://seki:seki@localhost:5432/seki`)
- `PORT` — HTTP port (default: 3000)
- `ENVIRONMENT` — set to `production` for secure cookies
- `STATIC_DIR` — static file path (Docker sets `/app/static`)

## Key Dependency Versions

axum 0.8, tower-sessions 0.14 (must use 0.14+ for axum-core 0.5 compat), tower-sessions-sqlx-store 0.15, sqlx 0.8 (postgres), askama 0.15, Rust edition 2021, Node 24, pnpm, Preact 10, esbuild 0.24, wasm-bindgen 0.2, js-sys 0.3.

## Conventions

- Conventional commit messages, single-line unless verbose explanation warranted
- Minimum handicap = 2 stones
- `Engine::is_legal(point, stone)` takes `Stone` directly, not `Option<Stone>`
- Serialization: `{"board": [[i8]], "captures": {"1": n, "-1": n}, "ko": {"point": [i8,i8], "stone": i8}, "stage": "string"}`
- TypeScript: prefer `type` over `interface`, never use `as unknown as`
