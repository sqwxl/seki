# Research: File Split Plans

**Feature**: Refactor Large Files  
**Date**: 2026-05-16

## Decision 1: territory.rs → territory/ directory (go-engine)

**Decision**: Split into 4 submodules under `go-engine/src/territory/`

| Submodule | Content | ~Lines |
|-----------|---------|--------|
| `alive.rs` | `find_unconditionally_alive`, `EnclosedRegion`, `find_enclosed_regions`, `is_vital_for` | ~260 |
| `dead_stones.rs` | `detect_dead_stones`, `Rng`, `PlayoutBoard`, `play_till_end`, `get_probability_map` | ~380 |
| `scoring.rs` | `estimate_territory`, `PlayerPoints`, `GameScore`, `score`, `format_result` | ~500 |
| `mod.rs` | Module declarations + `pub use` re-exports for backward compatibility | ~30 |

**Rationale**: Territory already has clear subdomains (Benson algorithm, Monte Carlo playouts, scoring, dead stone UI). The private `Rng` + `PlayoutBoard` + playout functions are tightly coupled — keeping them together avoids fragmenting a cohesive subsystem. The scoring module includes `estimate_territory` because scoring depends on territory estimates. The `toggle_dead_chain` function (17 lines) is folded into `mod.rs` as a re-export rather than getting its own file.

**Alternatives considered**:
- Single-file split (alive + dead + scoring in 3 files): Puts `PlayerPoints`/`GameScore` types awkwardly in the scoring file alongside unrelated territory estimate logic. Preferred the 4-file split for cleaner separation.
- Splitting `dead_stones.rs` further (separating Rng/PlayoutBoard from detection): Would create fragmented tiny files that make the playout subsystem harder to follow. The current 380-line estimate keeps it cohesive.
- Public re-exports via `pub use territory::*` in `lib.rs`: Larger blast radius; changed too many files unnecessarily. The `pub mod territory` in `lib.rs` already scopes all territory items under `go_engine::territory::*`.

---

## Decision 2: api.rs → api/ directory (seki-web routes)

**Decision**: Split into 7 submodules under `seki-web/src/routes/api/`

| Submodule | Content | ~Lines |
|-----------|---------|--------|
| `games.rs` | `list_games`, `create_game`, `get_game`, `delete_game`, `join_game` + `CreateGameRequest` + `JoinGameRequest` | ~280 |
| `game_actions.rs` | `play_move`, `pass`, `resign`, `abort`, `request_undo`, `respond_to_undo`, `toggle_chain`, `approve_territory` | ~320 |
| `challenges.rs` | `accept_challenge`, `decline_challenge`, `rematch_game` | ~210 |
| `messages.rs` | `get_messages`, `send_message` | ~110 |
| `turns.rs` | `get_turns` | ~80 |
| `users.rs` | `get_user`, `get_user_games`, `get_me` + `build_game_response` helper | ~160 |
| `mod.rs` | `ApiDoc` struct, `router()` function, module declarations | ~120 |

**Rationale**: Each submodule maps to a REST resource (games CRUD, game actions, challenges, messages, turns, users) following existing Axum conventions. Handlers are module-private — only `router()` is public and merges sub-routers. The `build_game_response` helper stays with `users.rs` since it's used by user-facing endpoints. `ApiDoc` and the `router()` stay in `mod.rs` since they're the aggregation point.

**Alternatives considered**:
- Group by HTTP method: Unnecessary indirection. Resource grouping is simpler.
- Fewer modules (e.g., merge challenges into game_actions): Challenges (accept/decline/rematch) are a distinct lifecycle phase from in-game actions (play/pass/resign/undo/territory). Separate files make the phase boundary clear.
- Single flat file with all handlers, only moving types out: Wouldn't solve the file size problem; the handler logic is what makes the file large.

---

## Decision 3: capabilities.ts → capabilities/ directory (frontend)

**Decision**: Split into 7 modules + 1 barrel re-export under `seki-web/frontend/src/game/capabilities/`

| Module | Content | ~Lines |
|--------|---------|--------|
| `types.ts` | `UiCapabilities`, `LiveGameControlsState`, `LiveGamePanelState`, `LiveGameStatusState`, `LiveGameMoveTreeState`, `AnalysisCapabilities` + internal helper types | ~220 |
| `build-overlay.ts` | `buildTerritoryOverlay`, `deriveTerritoryOverlay`, `isAnalysisCapablePhase` | ~50 |
| `build-panels.ts` | `buildPlayerPanels`, `derivePlayerPanel` + `ScoreInput`, `PanelScoreFields` types | ~120 |
| `live-game.ts` | `liveGameCapabilities` computed signal | ~395 |
| `controls.ts` | `liveGameControlsState` computed signal | ~180 |
| `panels.ts` | `liveGamePanelState` computed signal | ~40 |
| `status.ts` | `liveGameStatusState` computed signal | ~150 |
| `move-tree.ts` | `liveGameMoveTreeState` computed signal | ~10 |
| `analysis.ts` | `analysisCapabilities` computed signal | ~35 |
| `index.ts` | Barrel re-exports of all public items | ~15 |

**Rationale**: Each computed signal gets its own module — this matches how they're consumed (each consumer imports only the signals it needs). Types are centralized in `types.ts` since they're shared across all computed signals. The two builder functions (overlay, panels) are pure utilities independent of signals. The barrel `index.ts` ensures `import { liveGameCapabilities } from "../game/capabilities"` still works for the test file and any other consumers.

**Alternatives considered**:
- Fewer modules (e.g., one `computed.ts` for all signals): Doesn't solve the issue — the file would be ~700 lines.
- Types co-located with their consumers: Types like `UiCapabilities` are shared across multiple signals (controls, panels, status all `Pick` from it). Centralizing prevents circular imports.
- Skip the barrel index and update all importers: While cleaner long-term, the barrel provides a safe transition. Importers can be updated incrementally.

---

## Decision 4: Remaining files (P2) — classification

### Files to split

| File | Lines | Split plan |
|------|-------|------------|
| `services/game_actions/mod.rs` | 1092 | Split into `play.rs` (play_move, pass), `resign.rs` (resign, abort), `challenges.rs` (accept_challenge, decline_challenge), `undo.rs` (request_undo, respond_to_undo), `territory.rs` (toggle_chain, approve_territory, territory timeout), `chat.rs` (send_chat, handle_timeout_flag, end_game_on_time) |
| `frontend/goban/create-board.tsx` | 929 | Split WASM initialization + config types into `init-wasm.ts`, board rendering into `render-board.ts`, leave `create-board.tsx` as orchestration barrel |
| `frontend/components/controls.tsx` | 862 | Already contains discrete components — split each into own file: `GameControls.tsx`, `NavControls.tsx`, `UIControls.tsx`, `LobbyControls.tsx`, `LobbyPopover.tsx` |
| `go-engine/src/sgf/parser.rs` | 828 | Split `parse_collection` + game tree into `collection.rs`, `parse_game_tree` + node parsing into `game_tree.rs`, property value parsers into `properties.rs` |
| `frontend/layouts/live-game.tsx` | 820 | Move render sub-components into separate files: `live-game/board-section.tsx`, `live-game/sidebar.tsx`, `live-game/game-info.tsx` |
| `seki-web/src/routes/web_api.rs` | 665 | Resource-based split similar to api.rs: `web_api/games.rs`, `web_api/users.ts`, `web_api/settings.rs` |
| `frontend/layouts/live-game-page.tsx` | 657 | Extract event handlers and phase-transition logic into `live-game/phase-transitions.ts` |
| `seki-web/src/ws/registry.rs` | 541 | Extract cleanup/timer logic into `registry_cleanup.rs` |
| `frontend/layouts/form-variants/direct-challenge.tsx` | 516 | Extract time-control form section and validation logic |

### Files to justify (documented cohesion)

| File | Lines | Justification |
|------|-------|--------------|
| `go-engine/src/replay.rs` | 1050 | Single `Replay` struct + one large `impl` block. Replay navigation is a tightly coupled state machine. Splitting the impl would scatter related methods across files and hurt readability. Documented at top of file. |
| `go-engine/src/engine.rs` | 797 | Core `Engine` struct with ~20 short methods. Each method is 10-30 lines. Splitting would require either scattered impl blocks or a heavy EngineBuilder pattern — more complexity than benefit. |
| `seki-web/src/services/clock.rs` | 767 | Single domain (Fischer time control). `ClockState` + `ClockUpdate` + `LagTracker` + `TimeControl` enum are all about one concept. Splitting would create fragmented 200-line files with cross-references. |
| `seki-web/src/models/game.rs` | 757 | Game model + all DB queries. Co-located because they all operate on the `games` table. Splitting queries into separate files would add `use` chains without reducing cognitive load. |
| `go-engine/src/goban.rs` | 618 | Core board type + methods. Similar to engine.rs — short methods on a single struct. Cohesion is high; splitting adds indirection for no readability gain. |

**Rationale**: The constitution allows files over 500 lines when they justify cohesion. These 5 files each represent a single domain entity (board, engine, clock, replay, game model) where methods are short and tightly related. The complexity cost of splitting exceeds the readability benefit.

---

## Decision 5: Re-export strategy

**Decision**: Use directory modules with barrel re-exports.

**Rust pattern**:
```
// territory/mod.rs
mod alive;
mod dead_stones;
mod scoring;

pub use alive::find_unconditionally_alive;
pub use dead_stones::detect_dead_stones;
pub use scoring::{estimate_territory, score, PlayerPoints, GameScore, format_result};
pub use toggle::toggle_dead_chain;
```

**TypeScript pattern**:
```typescript
// capabilities/index.ts
export type { UiCapabilities, LiveGameControlsState, ... } from "./types";
export { buildTerritoryOverlay } from "./build-overlay";
export { liveGameCapabilities } from "./live-game";
// ...
```

**Rationale**: Explicit re-exports (as opposed to `pub use x::*` or `export * from`) make the public API visible at a glance in the barrel file. This is consistent with the codebase's preference for explicitness over wildcard imports.

**Alternatives considered**:
- Wildcard re-exports (`pub use alive::*`): Shorter but hides what's exported. Against project convention.
- No barrel, update all importers: Cleaner end state but higher risk — a single missed import breaks the build. Barrel provides safe incremental migration.
