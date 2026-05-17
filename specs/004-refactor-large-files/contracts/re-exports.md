# Re-export Contracts

**Feature**: Refactor Large Files  
**Purpose**: Document the public API surfaces that must remain stable across file splits.

## go-engine: territory module

**Current path**: `go_engine::territory::*` (via `pub mod territory;` in lib.rs)  
**New path**: `go_engine::territory::*` (via `pub use` re-exports in `territory/mod.rs`)

**Required re-exports:**

| Symbol | Kind | Used by |
|--------|------|---------|
| `detect_dead_stones` | fn | `seki-web/src/services/game_actions/mod.rs:252`, `seki-web/src/ws/game_channel.rs:50`, `go-engine-wasm/src/lib.rs:309` |
| `estimate_territory` | fn | `seki-web/src/services/game_actions/territory.rs:109`, `go-engine-wasm/src/lib.rs:326,335` |
| `score` | fn | `seki-web/src/services/game_actions/territory.rs:110`, `go-engine-wasm/src/lib.rs:336` |
| `toggle_dead_chain` | fn | `go-engine-wasm/src/lib.rs:318` |
| `find_unconditionally_alive` | fn | Currently only used within territory.rs itself and tests |
| `format_result` | fn | Usage via `GameScore::result()` |
| `PlayerPoints` | struct | Used by `GameScore` (same module) and serialization downstream |
| `GameScore` | struct | Used by `GameScore::result()`, WASM score endpoint |

**Verification**: `cargo test -p go-engine` (all territory tests), `cargo test -p go-engine-wasm`, `cargo test -p seki-web`

---

## seki-web: api routes

**Current path**: `crate::routes::api::router()`  
**New path**: `crate::routes::api::router()` (via `api/mod.rs`)

**Required contract**:
- `router()` returns `Router<AppState>` with all existing API routes registered under the same paths
- All handler functions remain module-private (not `pub`)
- OpenAPI spec (`ApiDoc`) produces the same schema
- Rate limiting behavior unchanged

**Caller**: `seki-web/src/lib.rs:163` — `.nest("/api", routes::api::router().merge(routes::web_api::router()))`

**Verification**: `cargo test -p seki-web`, plus `cargo test -p seki-web --test ws_api` (tests hit real API endpoints)

---

## frontend: capabilities module

**Current path**: `../game/capabilities` imports  
**New path**: `../game/capabilities/index.ts` barrel re-exports

**Required exports** (must all be importable from `../game/capabilities`):

| Symbol | Type | Imported by |
|--------|------|-------------|
| `liveGameControlsState` | computed signal | `layouts/live-game-page.tsx` |
| `liveGameMoveTreeState` | computed signal | `layouts/live-game-page.tsx` |
| `liveGamePanelState` | computed signal | `layouts/live-game-page.tsx` |
| `liveGameStatusState` | computed signal | `layouts/live-game-page.tsx` |
| `buildTerritoryOverlay` | function | `layouts/live-game-page.tsx` |
| `LiveGameControlsState` | type | `layouts/live-game-page.tsx` |
| `LiveGameStatusState` | type | `layouts/live-game-page.tsx` |
| `analysisCapabilities` | computed signal | `layouts/analysis-page.tsx` |
| `AnalysisCapabilities` | type | `layouts/analysis-page.tsx` |
| `buildPlayerPanels` | function | `layouts/analysis.tsx` |
| `liveGameCapabilities` | computed signal | `__tests__/capabilities.test.ts` |

**Verification**: `pnpm run typecheck`, `pnpm test`
