# Tasks: Refactor Large Files

**Input**: Design documents from `/specs/004-refactor-large-files/`

**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/re-exports.md, quickstart.md

**Tests**: No new tests required — this is a pure refactoring. Each task includes a verification step to confirm zero behavioral change. The constitution requires that all existing tests pass with unchanged assertions (FR-006).

**File size**: All tasks move code to keep source files ≤ 500 lines per Constitution Principle VI and FR-001. Splits follow research.md decisions.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Path Conventions

- **Engine**: `go-engine/src/` for pure game logic, SGF, game tree, replay, and scoring
- **WASM boundary**: `go-engine-wasm/src/` for wasm-bindgen conversion only
- **Web backend**: `seki-web/src/models/`, `services/`, `routes/`, `ws/`, `templates/`
- **Frontend**: `seki-web/frontend/src/game/`, `goban/`, `components/`, `layouts/`, `utils/`, `__tests__/`
- **Database**: SQLite migrations in `seki-web/migrations/`; add new numbered files only
- **Docs**: `README.md`, `FRONTEND_SPEC.md`, `API_SPEC.md`

---

## Phase 1: Setup (Baseline & Tooling)

**Purpose**: Establish baseline metrics and create the enforcement script

- [x] T001 Run baseline verification: `cargo test --all` and `pnpm run typecheck && pnpm test` in `seki-web/frontend/`
- [x] T002 Run baseline file-size audit: find non-test source files over 500 lines and record count
- [x] T003 Create file-size check script at `scripts/check-file-size.sh` that reports any non-test `.rs`, `.ts`, `.tsx` file exceeding 500 lines (excludes `__tests__/`, `target/`, `node_modules/`)

**Checkpoint**: Baseline verified, enforcement script ready

---

## Phase 2: User Story 1 — Split territory.rs (Priority: P1) 🎯 MVP

**Goal**: Split `go-engine/src/territory.rs` (1616 lines) into submodules under `go-engine/src/territory/`, each ≤ 500 lines, with re-exports preserving the `go_engine::territory::*` public API.

**Independent Test**: `cargo test -p go-engine -- territory` passes with zero assertion changes, and no submodule exceeds 500 lines.

### Implementation for User Story 1

- [x] T004 [US1] Create `go-engine/src/territory/` directory
- [x] T005 [P] [US1] Extract `find_unconditionally_alive`, `EnclosedRegion`, `find_enclosed_regions`, `is_vital_for` into `go-engine/src/territory/alive.rs` (~260 lines)
- [x] T006 [P] [US1] Extract `detect_dead_stones`, `Rng`, `PlayoutBoard`, `play_till_end`, `get_probability_map` into `go-engine/src/territory/dead_stones.rs` (~380 lines)
- [x] T007 [P] [US1] Extract `estimate_territory`, `PlayerPoints`, `GameScore`, `score`, `format_result`, `toggle_dead_chain` into `go-engine/src/territory/scoring.rs` (~500 lines)
- [x] T008 [US1] Create `go-engine/src/territory/mod.rs` with `mod` declarations and `pub use` re-exports for all public items per `specs/004-refactor-large-files/contracts/re-exports.md`
- [x] T009 [US1] Delete `go-engine/src/territory.rs` and update `go-engine/src/lib.rs` to use `pub mod territory;` pointing to the directory module
- [x] T010 [US1] Fix any compilation errors in `go-engine-wasm/src/lib.rs` and `seki-web/src/` caused by the territory module restructure; verify `go_engine::territory::*` paths still resolve
- [x] T011 [US1] Verify: `cargo test -p go-engine -- territory`, `cargo test -p go-engine-wasm`, `cargo test -p seki-web`

**Checkpoint**: territory.rs split complete, all tests pass, WASM boundary intact

---

## Phase 3: User Story 2 — Split api.rs (Priority: P1)

**Goal**: Split `seki-web/src/routes/api.rs` (1199 lines) into resource-focused submodules under `seki-web/src/routes/api/`, each ≤ 500 lines. The `router()` function must continue to return a single merged `Router<AppState>`.

**Independent Test**: `cargo test -p seki-web` passes. All API endpoints respond identically. `cargo test -p seki-web --test ws_api` passes.

### Implementation for User Story 2

- [x] T012 [US2] Create `seki-web/src/routes/api/` directory
- [x] T013 [P] [US2] Extract `list_games`, `create_game`, `get_game`, `delete_game`, `join_game` handlers + `CreateGameRequest`, `JoinGameRequest` into `seki-web/src/routes/api/games.rs` (~280 lines)
- [x] T014 [P] [US2] Extract `play_move`, `pass`, `resign`, `abort`, `request_undo`, `respond_to_undo`, `toggle_chain`, `approve_territory` handlers into `seki-web/src/routes/api/game_actions.rs` (~320 lines)
- [x] T015 [P] [US2] Extract `accept_challenge`, `decline_challenge`, `rematch_game` handlers into `seki-web/src/routes/api/challenges.rs` (~210 lines)
- [x] T016 [P] [US2] Extract `get_messages`, `send_message` handlers into `seki-web/src/routes/api/messages.rs` (~110 lines)
- [x] T017 [P] [US2] Extract `get_turns` handler into `seki-web/src/routes/api/turns.rs` (~80 lines)
- [x] T018 [P] [US2] Extract `get_user`, `get_user_games`, `get_me` handlers + `build_game_response` helper into `seki-web/src/routes/api/users.rs` (~160 lines)
- [x] T019 [US2] Create `seki-web/src/routes/api/mod.rs` with `ApiDoc`, `router()` function (merges sub-routers), `SCALAR_HTML`, and `mod` declarations
- [x] T020 [US2] Delete `seki-web/src/routes/api.rs` and update `seki-web/src/lib.rs` to use `mod api;` pointing to the directory module
- [x] T021 [US2] Verify: `cargo test -p seki-web`, `cargo test -p seki-web --test ws_api`

**Checkpoint**: api.rs split complete, all API tests pass, OpenAPI spec unchanged

---

## Phase 4: User Story 3 — Decompose capabilities.ts (Priority: P1)

**Goal**: Split `seki-web/frontend/src/game/capabilities.ts` (1195 lines) into focused modules under `seki-web/frontend/src/game/capabilities/`, each ≤ 500 lines, with barrel re-exports preserving all existing import paths.

**Independent Test**: `pnpm run typecheck` passes. `pnpm test` passes. All frontend importers (`live-game-page.tsx`, `analysis-page.tsx`, `analysis.tsx`, `capabilities.test.ts`) resolve without changes.

### Implementation for User Story 3

- [x] T022 [US3] Create `seki-web/frontend/src/game/capabilities/` directory
- [x] T023 [P] [US3] Extract `UiCapabilities`, `LiveGameControlsState`, `LiveGamePanelState`, `LiveGameStatusState`, `LiveGameMoveTreeState`, `AnalysisCapabilities` + internal helpers into `seki-web/frontend/src/game/capabilities/types.ts` (~220 lines)
- [x] T024 [P] [US3] Extract `buildTerritoryOverlay`, `deriveTerritoryOverlay`, `isAnalysisCapablePhase` into `seki-web/frontend/src/game/capabilities/build-overlay.ts` (~50 lines)
- [x] T025 [P] [US3] Extract `buildPlayerPanels`, `derivePlayerPanel` + `ScoreInput`, `PanelScoreFields` into `seki-web/frontend/src/game/capabilities/build-panels.ts` (~120 lines)
- [x] T026 [P] [US3] Extract `liveGameCapabilities` computed signal into `seki-web/frontend/src/game/capabilities/live-game.ts` (~395 lines)
- [x] T027 [P] [US3] Extract `liveGameControlsState` computed signal into `seki-web/frontend/src/game/capabilities/controls.ts` (~180 lines)
- [x] T028 [P] [US3] Extract `liveGamePanelState` computed signal into `seki-web/frontend/src/game/capabilities/panels.ts` (~40 lines)
- [x] T029 [P] [US3] Extract `liveGameStatusState` computed signal into `seki-web/frontend/src/game/capabilities/status.ts` (~150 lines)
- [x] T030 [P] [US3] Extract `liveGameMoveTreeState` computed signal into `seki-web/frontend/src/game/capabilities/move-tree.ts` (~10 lines)
- [x] T031 [P] [US3] Extract `analysisCapabilities` computed signal into `seki-web/frontend/src/game/capabilities/analysis.ts` (~35 lines)
- [x] T032 [US3] Create `seki-web/frontend/src/game/capabilities/index.ts` with barrel re-exports of all public items per `specs/004-refactor-large-files/contracts/re-exports.md`
- [x] T033 [US3] Delete `seki-web/frontend/src/game/capabilities.ts`
- [x] T034 [US3] Verify: `pnpm run typecheck` and `pnpm test` in `seki-web/frontend/`

**Checkpoint**: capabilities.ts split complete, typecheck and tests pass, all importers unchanged

---

## Phase 5: User Story 4 — Clean up remaining files (Priority: P2)

**Goal**: Address the 14 remaining files over 500 lines: split 9 files, add cohesion justification comments to 5 files.

**Independent Test**: `cargo test --all` and `pnpm run typecheck && pnpm test` pass. File size check (T002) confirms all non-test source files ≤ 500 lines or have documented justification.

### Files to split (9 files)

- [x] T035 [P] [US4] Split `seki-web/src/services/game_actions/mod.rs` (1092 lines) into sub-routines per research.md: create `seki-web/src/services/game_actions/play.rs` (play_move, pass), `resign.rs` (resign, abort), `undo.rs` (request_undo, respond_to_undo), `chat.rs` (send_chat, timeout handlers), update `mod.rs` with re-exports
- [x] T036 [P] [US4] Split `seki-web/frontend/src/goban/create-board.tsx` (929 lines): extract WASM init + config types into `seki-web/frontend/src/goban/init-wasm.ts`, board rendering into `seki-web/frontend/src/goban/render-board.ts`, keep `create-board.tsx` as orchestration barrel
- [x] T037 [P] [US4] Split `seki-web/frontend/src/components/controls.tsx` (862 lines): extract `GameControls`, `NavControls`, `UIControls`, `LobbyControls`, `LobbyPopover` each into own file under `seki-web/frontend/src/components/`
- [x] T038 [P] [US4] Split `go-engine/src/sgf/parser.rs` (828 lines): extract collection + game tree into `go-engine/src/sgf/collection.rs`, parse_game_tree + node parsing into `go-engine/src/sgf/game_tree.rs`, property value parsers into `go-engine/src/sgf/properties.rs`. Update `go-engine/src/sgf/mod.rs` with re-exports. Preserve `sgf::parse_sgf` entry point (CB-004).
- [x] T039 [P] [US4] Split `seki-web/frontend/src/layouts/live-game.tsx` (820 lines): extract board section into `seki-web/frontend/src/layouts/live-game/board-section.tsx`, sidebar into `seki-web/frontend/src/layouts/live-game/sidebar.tsx`, game info into `seki-web/frontend/src/layouts/live-game/game-info.tsx`
- [x] T040 [P] [US4] Split `seki-web/src/routes/web_api.rs` (665 lines): extract games handlers into `seki-web/src/routes/web_api/games.rs`, user handlers into `seki-web/src/routes/web_api/users.rs`, settings handlers into `seki-web/src/routes/web_api/settings.rs`. Update `web_api/mod.rs` with re-exports.
- [x] T041 [P] [US4] Split `seki-web/frontend/src/layouts/live-game-page.tsx` (657 lines): extract phase-transition logic + event handlers into `seki-web/frontend/src/layouts/live-game/phase-transitions.ts`
- [x] T042 [P] [US4] Split `seki-web/src/ws/registry.rs` (541 lines): extract cleanup/timer logic into `seki-web/src/ws/registry_cleanup.rs`
- [x] T043 [P] [US4] Split `seki-web/frontend/src/layouts/form-variants/direct-challenge.tsx` (516 lines): extract time-control fields + validation into `seki-web/frontend/src/layouts/form-variants/direct-challenge/time-control.tsx`
- [x] T044 [P] [US4] Add cohesion justification comment at top of `go-engine/src/replay.rs` explaining why 1050-line single-file `Replay` impl is appropriate (tightly coupled state machine)
- [x] T045 [P] [US4] Add cohesion justification comment at top of `go-engine/src/engine.rs` explaining why 797-line single-file `Engine` impl is appropriate (~20 short methods on one struct)
- [x] T046 [P] [US4] Add cohesion justification comment at top of `seki-web/src/services/clock.rs` explaining why 767-line single-file clock domain is appropriate (single concept: Fischer time control)
- [x] T047 [P] [US4] Add cohesion justification comment at top of `seki-web/src/models/game.rs` explaining why 757-line single-file model is appropriate (all queries operate on `games` table)
- [x] T048 [P] [US4] Add cohesion justification comment at top of `go-engine/src/goban.rs` explaining why 618-line single-file board type is appropriate (short methods on single struct)
- [x] T049 [US4] Full verification: `cargo test --all` and `pnpm run typecheck && pnpm test` in `seki-web/frontend/`. Run `scripts/check-file-size.sh` and confirm all non-test source files ≤ 500 lines or have justification comment.

**Checkpoint**: All 14 remaining files addressed, full test suite green, file size audit clean

---

## Phase 6: User Story 5 — Automated enforcement (Priority: P3)

**Goal**: Integrate the file-size check script into developer workflow so regressions are caught before code review.

**Independent Test**: Creating a source file over 500 lines (excluding test files) causes the check to fail with a clear message.

### Implementation for User Story 5

- [x] T050 [US5] Verify `scripts/check-file-size.sh` (T003) works correctly: run it and confirm it reports 0 issues after all prior splits are complete
- [x] T051 [US5] Document the file-size check in `AGENTS.md` or README so new contributors know about it
- [x] T052 [US5] (Optional) Add a CI step or pre-commit reference for `scripts/check-file-size.sh` if CI infrastructure exists

**Checkpoint**: Enforcement script functional, documented, catches regressions

---

## Phase 7: Polish & Final Verification

**Purpose**: Cross-cutting verification and documentation

- [x] T053 Run `specs/004-refactor-large-files/quickstart.md` full verification checklist
- [x] T054 Confirm SC-001: 100% of non-test source files ≤ 500 lines or have documented justification
- [x] T055 Update `AGENTS.md` plan reference if needed (post-feature cleanup)

**Checkpoint**: Feature complete, all success criteria met

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — can start immediately
- **User Story 1 (Phase 2)**: No dependencies on other stories — can start after Setup
- **User Story 2 (Phase 3)**: No dependencies on other stories — can start after Setup
- **User Story 3 (Phase 4)**: No dependencies on other stories — can start after Setup
- **User Story 4 (Phase 5)**: Independent of US1-US3 but safer to run after P1 stories are complete (files being split may import from refactored modules)
- **User Story 5 (Phase 6)**: Depends on all splits being complete (needs accurate audit)
- **Polish (Phase 7)**: Depends on all prior phases

### User Story Dependencies

- **US1 (P1)**: Maps to territory.rs split — only touches go-engine + go-engine-wasm. Independent.
- **US2 (P1)**: Maps to api.rs split — only touches seki-web/src/routes/. Independent.
- **US3 (P1)**: Maps to capabilities.ts split — only touches frontend game/. Independent.
- **US4 (P2)**: Maps to remaining 14 files — safest after US1-US3 complete since some may import from refactored modules (e.g., `game_actions/mod.rs` uses `go_engine::territory::*`)
- **US5 (P3)**: Maps to enforcement script — requires all splits done for accurate audit

### Parallel Opportunities

- US1, US2, and US3 can all run in **fully parallel** after Setup — they touch separate codebases (Rust engine, Rust web, TypeScript frontend)
- Within US1: T005, T006, T007 can run in parallel (different files)
- Within US2: T013-T018 can run in parallel (different resource modules)
- Within US3: T023-T031 can run in parallel (different concern modules)
- Within US4: All split tasks (T035-T043) can run in parallel. All justification tasks (T044-T048) can run in parallel.
- US4 split tasks and justification tasks can run in parallel with each other

---

## Parallel Example: User Story 1

```bash
# Launch all extractions in parallel (different files, no conflicts):
Task: "Extract alive detection into go-engine/src/territory/alive.rs"
Task: "Extract dead stone detection into go-engine/src/territory/dead_stones.rs"
Task: "Extract scoring into go-engine/src/territory/scoring.rs"

# Then sequentially:
Task: "Create go-engine/src/territory/mod.rs with re-exports"
Task: "Delete go-engine/src/territory.rs"
Task: "Fix imports and verify"
```

## Parallel Example: User Stories 1, 2, 3

```bash
# After Setup, all three P1 stories can run simultaneously:
Developer A: Phase 2 (US1 — territory.rs split, Rust engine)
Developer B: Phase 3 (US2 — api.rs split, Rust web routes)
Developer C: Phase 4 (US3 — capabilities.ts split, TypeScript frontend)
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup (baseline + enforcement script)
2. Complete Phase 2: User Story 1 (territory.rs split)
3. **STOP and VALIDATE**: `cargo test -p go-engine -- territory` passes, file size check shows territory/ files ≤ 500 lines
4. This alone delivers the core value of splitting the single largest file

### Incremental Delivery

1. Setup → baseline established
2. US1 → territory.rs split, verify → **first value delivered**
3. US2 → api.rs split, verify → routes maintainable
4. US3 → capabilities.ts split, verify → frontend modularized
5. US4 → remaining 14 files addressed, verify → full constitution compliance
6. US5 → enforcement integrated, document → regressions prevented

### Recommended Order

Since US1-US3 are independent, tackle them in order of blast radius (smallest first):
1. US1 (go-engine only, fewest external consumers to verify)
2. US2 (seki-web routes, medium blast radius)
3. US3 (frontend, requires typecheck + tests)
4. US4 (sweeps remaining files, may need P1 imports to be stable)
5. US5 (enforcement, requires all splits done for accurate audit)

---

## Notes

- [P] tasks = different files, no dependencies — can run in parallel
- [Story] label maps task to specific user story for traceability
- Each user story SHOULD be independently completable and testable
- US1-US3 are fully independent (separate crates/languages); US4 is safest after them
- Commit logical groups directly to `main` after each story checkpoint
- Stop at any checkpoint to validate story independently
- The barrel re-export pattern (Rust `mod.rs` + `pub use`, TS `index.ts`) preserves backward compatibility per FR-005
- Cohesion justification comments should be concise (1-2 lines) explaining why splitting would hurt readability more than it helps
