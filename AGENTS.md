# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Test Commands

```bash
# Rust (workspace root)
cargo build                          # build all crates
cargo test --all                     # run all tests (103 tests, mostly in go-engine)
cargo test -p go-engine              # engine tests only
cargo test -p go-engine -- ko        # run tests matching "ko"
cargo check --all                    # type-check without building

# Frontend (seki-web/frontend/)
npm install                          # install deps
npm run build                        # esbuild: src/go.tsx → ../static/dist/bundle.js
npm run dev                          # watch mode
npm run typecheck                    # tsc --noEmit

# Docker
docker-compose up                    # postgres + web service on :3000
```

## Architecture

Cargo workspace with two crates:

### go-engine
Pure game logic library. No IO, no async. Clone-on-write board state — `Goban::play()`/`pass()` return a new `Goban` rather than mutating. Key types: `Engine`, `Goban`, `Stone` (Black=1, White=-1), `Turn`, `Stage`. Also includes an SGF parser/serializer (`go_engine::sgf`).

### seki-web
Axum 0.8 web app. Modules follow a clean separation: `models/` (sqlx queries), `services/` (engine building, game creation, state serialization), `routes/` (HTTP handlers), `ws/` (WebSocket game channels), `templates/` (Askama template structs).

**Request flow:** Axum router → route handler → service layer → model (sqlx) → DB. Templates render server-side HTML. The game board UI is a Preact app (`seki-web/frontend/`) bundled with esbuild, loaded on the game show page, communicating via WebSocket at `/games/{id}/ws`.

**Real-time:** `GameRegistry` manages per-game WebSocket channels. On connect, server sends full game state; subsequent moves are broadcast to all connected players.

**Auth:** tower-sessions with PostgreSQL store. `CurrentPlayer` extractor auto-creates anonymous players (random session token) if no session exists. Registration adds email/username/password (Argon2).

## Database

PostgreSQL via sqlx 0.8. **Single migration file:** `seki-web/migrations/001_initial.sql` — edit this directly, never create new migration files. Uses `IF NOT EXISTS` for idempotency. Migrations run at app startup.

Tables: `players`, `games`, `turns`, `messages`, `territory_reviews`.

## Environment Variables

- `DATABASE_URL` — postgres connection string (default: `postgres://seki:seki@localhost:5432/seki`)
- `PORT` — HTTP port (default: 3000)
- `ENVIRONMENT` — set to `production` for secure cookies
- `STATIC_DIR` — static file path (Docker sets `/app/static`)

## Key Dependency Versions

axum 0.8, tower-sessions 0.14 (must use 0.14+ for axum-core 0.5 compat), tower-sessions-sqlx-store 0.15, sqlx 0.8 (postgres), askama 0.15, Rust edition 2021, Node 24, Preact 10, esbuild 0.24.

## Conventions

- Conventional commit messages, single-line unless verbose explanation warranted
- Minimum handicap = 2 stones
- `Engine::is_legal(point, stone)` takes `Stone` directly, not `Option<Stone>`
- Serialization: `{"board": [[i8]], "captures": {"1": n, "-1": n}, "ko": {"point": [i8,i8], "stone": i8}, "stage": "string"}`
- TypeScript: prefer `type` over `interface`, never use `as unknown as`
