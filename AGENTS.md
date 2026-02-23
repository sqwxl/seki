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

**Frontend modules** (`seki-web/frontend/src/`): `index.ts` is the entry point. Code is organized into five directories:
- `game/` — Live game session state: `context.ts` (GameCtx), `messages.ts` (WS message handler), `channel.ts` (WS action wrappers), `clock.ts` (clock formatting/sync), `ui.ts` (title, turn flash, score), `sound.ts`, `notifications.ts`, `util.ts` (user data helpers)
- `goban/` — Board rendering + WASM bridge: Preact Goban component, `create-board.tsx` (board factory with navigation, territory review, localStorage persistence), `types.ts`
- `components/` — Reusable Preact UI: `controls.tsx`, `chat.tsx`, `player-panel.tsx`, `move-tree.tsx`, `icons.tsx`, `nav-status.tsx`, `game-description.tsx`, `user-label.tsx`
- `layouts/` — Page-level orchestrators: `live-game.tsx`, `analysis.tsx`, `games-list.tsx`, `user-games.tsx`, `game-settings-form.tsx`, `game-page-layout.tsx`
- `utils/` — Stateless helpers: `format.ts`, `sgf.ts`, `premove.ts`, `coord-toggle.ts`, `shared-controls.ts`

**Real-time:** A single WebSocket endpoint (`/ws`) handles all real-time communication. Clients subscribe to game rooms via `join_game`/`leave_game` messages, and receive lobby events (game list updates) via a broadcast channel. `GameRegistry` manages per-game rooms; on join, server sends full game state, and subsequent moves are broadcast to all connected players.

**Auth (web):** tower-sessions with PostgreSQL store. `CurrentUser` extractor auto-creates anonymous users (random session token) if no session exists. Registration adds email/username/password (Argon2).

**Auth (API):** Bearer token authentication. `ApiUser` extractor reads `Authorization: Bearer <token>` header, looks up by `api_token` column, requires a registered account, returns 401 JSON on failure. Tokens are managed from the `/settings` web page.

**API routes** (`/api/*`): JSON endpoints for programmatic access. Authenticated endpoints use `ApiUser`; public endpoints (list games, get game, get messages, get turns) are unauthenticated. Session-based auth concepts (login, register, logout) are not part of the API — those are web-only routes.

## Database

PostgreSQL via sqlx 0.8. Migrations live in `seki-web/migrations/` as numbered files (001, 002, …). **Never modify existing migration files** — always create new numbered migrations. Migrations run at app startup.

Tables: `users`, `games`, `turns`, `messages`, `territory_reviews`. Clock state is stored directly on the `games` table (`clock_black_ms`, `clock_white_ms`, `clock_black_periods`, `clock_white_periods`, `clock_active_stone`, `clock_last_move_at`, `clock_expires_at`).

## Environment Variables

- `DATABASE_URL` — postgres connection string (default: `postgres://seki:seki@localhost:5432/seki`)
- `PORT` — HTTP port (default: 3000)
- `ENVIRONMENT` — set to `production` for secure cookies
- `STATIC_DIR` — static file path (Docker sets `/app/static`)

## Key Dependency Versions

axum 0.8, tower-sessions 0.14 (must use 0.14+ for axum-core 0.5 compat), tower-sessions-sqlx-store 0.15, sqlx 0.8 (postgres), askama 0.15, Rust edition 2024, Node 24, pnpm, Preact 10, esbuild 0.24, wasm-bindgen 0.2, js-sys 0.3.

## Naming: User vs Player

- **User** = account/identity (`User` model in `models/user.rs`, `users` DB table, `CurrentUser`/`ApiUser` extractors, `UserData` template type)
- **Player** = game participant (`GameWithPlayers`, `has_player()`, `player_stone()`, `turn_player()`, `player_id` in game actions/channels)

## Conventions

- Conventional commit messages, single-line unless verbose explanation warranted
- Minimum handicap = 2 stones
- `Engine::is_legal(point, stone)` takes `Stone` directly, not `Option<Stone>`
- GameState serialization: `{"board": [i8], "cols": u8, "rows": u8, "captures": {"black": n, "white": n}, "ko": {"pos": [i8,i8], "illegal": i8}}`
- TypeScript: prefer `type` over `interface`, never use `as unknown as`
