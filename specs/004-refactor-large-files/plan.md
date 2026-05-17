# Implementation Plan: Refactor Large Files

**Branch**: `main` | **Date**: 2026-05-16 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/004-refactor-large-files/spec.md`

## Summary

Split 17 source files that exceed the 500-line guideline in AGENTS.md into focused submodules organized by purpose/concern. The three worst offenders (P1) are `go-engine/src/territory.rs` (1616 lines), `seki-web/src/routes/api.rs` (1199 lines), and `seki-web/frontend/src/game/capabilities.ts` (1195 lines). The remaining 14 files (P2) are either split or given documented justification. An automated check (P3) prevents regressions. Zero behavioral changes — all existing tests must pass with unchanged assertions.

## Technical Context

**Language/Version**: Rust Edition 2024, TypeScript strict mode, Node 24
**Primary Dependencies**: axum 0.8, sqlx 0.8, Preact 10, @preact/signals, go-engine (internal)
**Storage**: SQLite via sqlx 0.8 (no schema changes)
**Testing**: `cargo test --all`, `pnpm test` (Vitest), `pnpm run typecheck`
**Target Platform**: WASM (browser) + Linux server
**Project Type**: web-service with SPA frontend
**Performance Goals**: No performance change expected (pure code reorganization)
**Constraints**: Must preserve all public API surfaces, re-export paths, WASM boundary, and test assertions
**Scale/Scope**: 17 source files over 500 lines after test exemption, ~15k lines reorganized

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **Simplicity and minimal change**: This feature IS the enforcement of Constitution Principle VI. File splits address existing violations without creating new abstractions. No new dependencies. Each split is a minimal diff that moves code between files without changing behavior.
- **Layer ownership**: All code stays within its existing layer. `go-engine` splits stay in `go-engine`. Route handlers stay in `routes/`. Frontend computed signals stay in `game/`. No logic crosses layer boundaries.
- **Server enforcement**: N/A — pure refactoring, no behavioral changes to access control, validation, or API behavior.
- **SPA and JSON contracts**: No new routes, no new server-rendered templates, no changes to SPA shell or `/api/web/*` contracts.
- **File and module size**: This is the entire purpose of the feature. All 17 offending files are addressed.
- **Tests and documentation**: Verification: `cargo test --all`, `pnpm test`, `pnpm run typecheck`. No spec/doc updates needed (no behavior change). README checklist unaffected (this is internal quality work).

## Project Structure

### Documentation (this feature)

```text
specs/004-refactor-large-files/
├── plan.md              # This file
├── research.md          # Phase 0 output — file split plans
├── data-model.md        # Phase 1 output — (minimal, no new data)
├── quickstart.md        # Phase 1 output — verification commands
├── contracts/           # Phase 1 output — stable API boundaries
│   └── re-exports.md    # Public re-export contracts that must be preserved
└── tasks.md             # Phase 2 output (/speckit-tasks command)
```

### Source Code (repository root)

No new top-level directories. Files are reorganized within existing modules:

```text
go-engine/src/
├── territory/              # NEW: split from territory.rs
│   ├── mod.rs              # Re-exports all public items
│   ├── alive.rs            # find_unconditionally_alive + enclosed region helpers
│   ├── dead_stones.rs      # detect_dead_stones + Rng + PlayoutBoard + playouts
│   └── scoring.rs          # estimate_territory, toggle_dead_chain, score, PlayerPoints, GameScore

seki-web/src/routes/
├── api/                    # NEW: split from api.rs
│   ├── mod.rs              # router() + re-exports
│   ├── games.rs            # list, create, get, delete, join game handlers
│   ├── game_actions.rs     # play, pass, resign, abort, undo, territory handlers
│   ├── challenges.rs       # accept, decline, rematch handlers
│   ├── messages.rs         # get_messages, send_message handlers
│   ├── turns.rs            # get_turns handler
│   └── users.rs            # get_user, get_user_games, get_me handlers

seki-web/frontend/src/game/
├── capabilities/           # NEW: split from capabilities.ts
│   ├── index.ts            # Barrel re-exports for backward compatibility
│   ├── types.ts            # UiCapabilities, LiveGameControlsState, etc.
│   ├── build-overlay.ts    # buildTerritoryOverlay, deriveTerritoryOverlay
│   ├── build-panels.ts     # buildPlayerPanels, derivePlayerPanel
│   ├── live-game.ts        # liveGameCapabilities (master computed)
│   ├── controls.ts         # liveGameControlsState
│   ├── panels.ts           # liveGamePanelState
│   ├── status.ts           # liveGameStatusState
│   ├── move-tree.ts        # liveGameMoveTreeState
│   └── analysis.ts         # analysisCapabilities
```

**Structure Decision**: Each split follows the existing project convention of directory modules with `mod.rs` (Rust) or barrel `index.ts` (TypeScript). The public API surface is preserved through re-exports so existing importers don't break. Splits are grouped by concern — each submodule handles one logical domain within the parent.

## Complexity Tracking

> No violations to justify. This feature directly implements Constitution Principle VI and uses only the established module patterns already present in the codebase.
