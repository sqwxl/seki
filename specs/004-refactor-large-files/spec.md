# Feature Specification: Refactor Large Files

**Development Branch**: `main` unless explicitly requested otherwise

**Created**: 2026-05-16

**Status**: Draft

**Input**: User description: "a lot of files in this codebase break the constitution's stipulations on code complexity and file size. track down the worst offenders and write a spec to address the issue."

## Source References *(mandatory)*

- [AGENTS.md]: "Keep source files manageable; prefer 500 lines or less. If a file grows larger, justify why it remains cohesive or split it into modules organized by purpose/concern. Test files are exempt from this limit."
- [AGENTS.md]: "When a function starts taking too many parameters (>4), consider passing an object instead."
- [AGENTS.md]: "Prefer functional, stateless functions for most things; avoid side-effects and globally shared mutating variables"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Split the worst Rust source file (Priority: P1)

As a developer reading the codebase, I want `go-engine/src/territory.rs` (1616 lines) split into cohesive submodules so I can understand territory scoring logic without scrolling through a monolithic file. This is the single largest source file and contains multiple distinct concerns (estimate_territory, find_unconditionally_alive, detect_dead_stones, toggle_dead_chain, score, format_result, and associated types).

**Why this priority**: It's the largest non-test file at 3.2x the 500-line target, and territory logic is a self-contained domain with natural module boundaries.

**Independent Test**: `cargo test -p go-engine -- territory` passes without changes. All existing territory behavior is preserved; only file organization changes.

**Acceptance Scenarios**:

1. **Given** the current `territory.rs` at 1616 lines, **When** refactored into submodules (e.g., `territory/scoring.rs`, `territory/dead_stones.rs`, `territory/types.rs`), **Then** no single source file in the territory module exceeds 500 lines.
2. **Given** the refactored territory module, **When** running `cargo test -p go-engine`, **Then** all existing territory tests pass with unchanged assertions.

---

### User Story 2 - Break up the large API route file (Priority: P1)

As a developer adding a new API endpoint, I want `seki-web/src/routes/api.rs` (1199 lines) split into focused route modules (e.g., `routes/api/games.rs`, `routes/api/users.rs`) so I can find and modify the relevant handler without navigating a 1200-line file containing 25+ handler functions.

**Why this priority**: The API router is the second-largest source file and its growth directly impedes development velocity. Adding any new endpoint requires editing an already-bloated file.

**Independent Test**: `cargo test -p seki-web` passes with existing API tests. All API endpoints respond identically before and after.

**Acceptance Scenarios**:

1. **Given** `api.rs` at 1199 lines with 25+ handler functions, **When** split into focused submodules grouped by resource (games, users, settings, etc.), **Then** no single route submodule exceeds 500 lines.
2. **Given** the refactored route structure, **When** making a request to any previously-existing API endpoint, **Then** the response is identical in status code, headers, and body.

---

### User Story 3 - Decompose the capabilities module (Priority: P1)

As a frontend developer working on game state UI, I want `seki-web/frontend/src/game/capabilities.ts` (1195 lines) broken into focused computed-state modules (e.g., `game/ui-capabilities.ts`, `game/controls-state.ts`, `game/panel-state.ts`) so I can understand and modify one aspect of game UI state without parsing unrelated computed derivations.

**Why this priority**: It's a 1195-line TypeScript file where the type definitions alone span 200+ lines and computed state derivations for different UI concerns are all crammed together.

**Independent Test**: `pnpm run typecheck` passes. All existing frontend tests pass. The live game UI renders identically.

**Acceptance Scenarios**:

1. **Given** `capabilities.ts` at 1195 lines, **When** split into focused modules by UI concern (capability types, control state, panel state, territory overlay), **Then** no single resulting module exceeds 500 lines.
2. **Given** the decomposed capabilities modules, **When** `pnpm run typecheck` and `pnpm test` run, **Then** both pass with no new errors.

---

### User Story 4 - Clean up remaining files over 500 lines (Priority: P2)

As a developer, I want all remaining source files that exceed 500 lines to be evaluated and either split or documented with a justification, so the codebase consistently follows its own size guideline.

Files to address (excludes test files):

| File | Lines | Notes |
|------|-------|-------|
| `go-engine/src/replay.rs` | 1050 | Single `Replay` struct + impl; high cohesion |
| `seki-web/src/services/game_actions/mod.rs` | 1092 | 14 action functions; could split by action group |
| `seki-web/frontend/src/goban/create-board.tsx` | 929 | Board creation + WASM bridge + caching |
| `seki-web/frontend/src/components/controls.tsx` | 862 | Multiple UI control components in one file |
| `go-engine/src/sgf/parser.rs` | 828 | SGF parsing; already part of an `sgf/` submodule |
| `seki-web/frontend/src/layouts/live-game.tsx` | 820 | Live game layout composition |
| `go-engine/src/engine.rs` | 797 | Core engine; high cohesion |
| `seki-web/src/services/clock.rs` | 767 | Clock logic; single domain |
| `seki-web/src/models/game.rs` | 757 | Game queries + row types |
| `seki-web/src/routes/web_api.rs` | 665 | Web API routes |
| `seki-web/frontend/src/layouts/live-game-page.tsx` | 657 | Live game page composition |
| `go-engine/src/goban.rs` | 618 | Core board logic |
| `seki-web/src/ws/registry.rs` | 541 | WS game registry |
| `seki-web/frontend/src/layouts/form-variants/direct-challenge.tsx` | 516 | Challenge form variant |

**Why this priority**: These files compound the maintenance burden. After the P1 files are addressed, cleaning up the rest ensures the codebase consistently follows its own guidelines.

**Independent Test**: `cargo test --all` and `pnpm run typecheck && pnpm test` pass without changes. File size check script confirms all non-test source files ≤ 500 lines or have documented justification.

**Acceptance Scenarios**:

1. **Given** the list of 14 files over 500 lines, **When** each file is either split below 500 lines or has an AGENTS.md justification comment, **Then** a `wc -l` check confirms no non-test source file exceeds 500 lines without documented rationale.
2. **Given** the refactored files, **When** running the full test suite (`cargo test --all` and `pnpm test`), **Then** all tests pass with unchanged behavior.

---

### User Story 5 - Add automated enforcement (Priority: P3)

As a developer, I want a CI check or pre-commit hook that flags source files exceeding 500 lines so the team catches size regressions before they reach code review.

**Why this priority**: Prevention is cheaper than correction. Automated enforcement ensures the codebase doesn't regress after the cleanup.

**Independent Test**: Intentionally creating a file over 500 lines causes the check to fail in CI or locally.

**Acceptance Scenarios**:

1. **Given** a source file exceeding 500 lines (excluding test files), **When** the file-size check runs, **Then** the check fails with a message identifying the file and its line count.
2. **Given** all source files are ≤ 500 lines, **When** the file-size check runs, **Then** the check passes.

---

### Edge Cases

- What happens when a file is highly cohesive (e.g., `clock.rs` has one primary struct and its implementation)? It may be more harmful to split it. The spec allows for documented justification in these cases.
- Files at 501 lines: treat the 500-line limit as a soft guideline, not a strict ceiling. Files between 500-550 lines that are genuinely cohesive are acceptable with a brief inline justification.
- Refactoring must not change any public API. Existing imports from refactored modules must continue to work (through re-exports where necessary).
- WASM boundary (`go-engine-wasm`) must continue to expose the same interface after engine-side refactors.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Every non-test source file in the codebase MUST be ≤ 500 lines, OR have a documented justification in the file explaining why it remains cohesive as a single module.
- **FR-002**: `go-engine/src/territory.rs` MUST be split into submodules under a `territory/` directory, with each submodule ≤ 500 lines.
- **FR-003**: `seki-web/src/routes/api.rs` MUST be split into resource-focused submodules (e.g., games, users, settings), with each ≤ 500 lines.
- **FR-004**: `seki-web/frontend/src/game/capabilities.ts` MUST be decomposed into focused modules by UI concern, with each ≤ 500 lines.
- **FR-005**: All refactored modules MUST preserve their existing public API surface. Any re-exports needed to maintain backward compatibility MUST be provided.
- **FR-006**: All existing tests MUST continue to pass after refactoring, with zero assertion changes.
- **FR-007**: The `go-engine-wasm` crate's public interface MUST remain unchanged after any engine-side refactoring.
- **FR-008**: An automated check (shell script or CI step) MUST exist that reports any non-test source file exceeding 500 lines.
- **FR-009**: As a non-blocking recommendation, functions exceeding 4 parameters SHOULD be refactored to accept a parameter object where practical during file-splitting work, but this is not a gating success criterion for this feature.

### Contract and Boundary Requirements *(include when applicable)*

- **CB-001**: Public re-exports from `go_engine` crate root must remain stable. Any module that previously exported symbols at the crate level must continue to do so.
- **CB-002**: The `routes::api::router()` function must continue to return a single merged `Router` that handles all existing API paths.
- **CB-003**: Frontend imports of computed signals and types from `game/capabilities` must continue to work. A barrel re-export from `capabilities.ts` may be used during transition.
- **CB-004**: SGF parser (`go-engine/src/sgf/parser.rs`) refactoring must not change the `sgf::parse_sgf` public entry point.

### Key Entities

- **Source Module**: A cohesive unit of code organized by purpose or concern. Should be ≤ 500 lines or have documented justification.
- **Submodule**: A child module within a parent directory, exposed through `mod` declarations and potentially re-exported at the parent level.
- **Barrel Re-export**: A thin index file that re-exports symbols from submodules to maintain backward-compatible import paths.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: After refactoring, 100% of non-test source files are either ≤ 500 lines or have a documented justification comment.
- **SC-002**: The three largest files (`territory.rs`, `api.rs`, `capabilities.ts`) are each split so no resulting module exceeds 500 lines.
- **SC-003**: The full test suite (`cargo test --all` and `pnpm test`) passes with zero behavioral changes.
- **SC-004**: The automated file-size check correctly identifies any non-test source file over 500 lines and reports it clearly.
- **SC-005**: Developer onboarding time for understanding a given module is reduced — a new contributor can read any single source file in under 10 minutes (estimated at ~500 lines).

## Assumptions

- Test files are exempt from the 500-line limit (as stated in AGENTS.md).
- Files between 500-550 lines with a clear justification for cohesion are acceptable without splitting.
- The `clock.rs` file (767 lines, single primary concern) likely falls into the "justify cohesion" category rather than splitting, but the team will evaluate during implementation.
- Existing tests are comprehensive enough to catch behavioral regressions from refactoring.
- Re-exports (`pub use submodule::*`) are an acceptable compatibility mechanism during transition.
