# Implementation Plan: Ranked Game Form Redesign

**Branch**: `main` unless explicitly requested otherwise | **Date**: 2026-05-16 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/003-ranked-game-form/spec.md`

## Summary

Redesign the new game form (`/games/new`) to present three first-class creation variants — Open game, Direct challenge, and Email invite — each with a Rated/Unrated toggle that gates which settings are visible and editable. For rated games, handicap/komi/color are derived server-side from rating context rather than submitted by the user. For unrated games, all settings remain user-configurable. Email invites are never rated.

## Technical Context

**Language/Version**: Rust edition 2024 for backend; TypeScript with Preact 10 for frontend

**Primary Dependencies**: Axum 0.8, sqlx 0.8 SQLite, Preact 10, Vitest (existing stack — no new dependencies)

**Storage**: SQLite via sqlx 0.8; possible new migration for `max_handicap` column on games table

**Testing**: `cargo test -p seki-web`, `cargo check --all`, `pnpm run typecheck`, `pnpm test`

**Target Platform**: Linux-hosted Axum web service with browser SPA frontend

**Project Type**: Full-stack web application (frontend form redesign + minor backend DTO additions)

**Performance Goals**: Form rerenders (variant switch, rated toggle, opponent selection) must stay below 200ms perceived delay. The `/api/web/games/new` endpoint must return within existing page-load expectations.

**Constraints**: No `go-engine` or `go-engine-wasm` changes. The existing `game-settings-form.tsx` (~769 lines) already exceeds the 500-line guideline and will be split into variant-specific modules. Server-side ranked constraints must continue to reject invalid combinations.

**Scale/Scope**: Single frontend form screen restructuring. Backend adds a `max_handicap` parameter and extends the `/api/web/games/new` DTO with variant-specific data (derived settings preview for direct challenges, opponent filter data).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **Simplicity and minimal change**: Pass. The plan changes one frontend component and adds one backend parameter. No new dependencies. No engine/WASM changes. The existing `game_creator` service already derives ranked settings; this just changes what the frontend sends.
- **Layer ownership**: Pass. Frontend form logic in `layouts/game-settings-form.tsx`. Backend DTO extension in `routes/web_api.rs` and `services/game_creator.rs`. No logic leaks into wrong layer.
- **Server enforcement**: Pass. Ranked constraints remain enforced in `game_creator.rs`. The frontend presentation changes are convenience only; the server still rejects invalid manual handicap/komi for ranked games.
- **SPA and JSON contracts**: Pass. `/games/new` continues serving the SPA shell. Route data stays under `/api/web/games/new`. Variant-specific data extends the existing `NewGameData` DTO.
- **File and module size**: `game-settings-form.tsx` (~769 lines) already exceeds 500 lines and will be restructured. Plan splits it into: `game-settings-form.tsx` (orchestrator, ~200 lines), `variants/open-game.tsx`, `variants/direct-challenge.tsx`, `variants/email-invite.tsx` (each ~150-200 lines). Shared settings (time control, takebacks) stay in a shared module.
- **Tests and documentation**: Verification: `cargo test -p seki-web rating`, `pnpm run typecheck`, `pnpm test`. Docs: `FRONTEND_SPEC.md` game creation section, `README.md`.

## Project Structure

### Documentation (this feature)

```text
specs/003-ranked-game-form/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── new-game-form-contract.md
└── tasks.md
```

### Source Code (repository root)

```text
seki-web/
├── migrations/
│   └── 003_max_handicap.sql       # Add max_handicap column to games table
├── src/
│   ├── models/
│   │   └── game.rs                # Add max_handicap field, accept in create
│   ├── services/
│   │   └── game_creator.rs        # Accept max_handicap param, cap derived handicap
│   │   └── game_joiner.rs          # Cap derived handicap by max_handicap
│   └── routes/
│       └── web_api.rs             # Extend NewGameData DTO with variant fields
└── frontend/src/
    ├── layouts/
    │   ├── game-settings-form.tsx  # Orchestrator: variant selection, shared state
    │   ├── form-variants/
    │   │   ├── open-game.tsx       # Open game variant form
    │   │   ├── direct-challenge.tsx # Direct challenge variant form
    │   │   └── email-invite.tsx    # Email invite variant form
    │   └── __tests__/
    │       └── game-settings-form.test.ts  # Form variant tests
    └── utils/
        └── rating.ts              # May add derived settings preview helper
```

**Structure Decision**: Split the existing monolithic `game-settings-form.tsx` (~769 lines) into an orchestrator and three variant modules. This keeps each file under 500 lines and separates concerns cleanly. A `form-variants/` directory under `layouts/` houses the three variant forms, keeping them co-located with the parent orchestrator.

## Complexity Tracking

No constitution violations. The file split from one 769-line file into modules resolves the existing size concern proactively.

## Phase 0 Research

The feature requires no new technology decisions. Key design questions resolved:

- **Variant switching**: Radio button group selecting "Open game" / "Direct challenge" / "Email invite". Switching variants resets settings to defaults for that variant.
- **Max handicap slider**: Range 0–9 (maximum for 19×19 board). Stored as `max_handicap` on the games table. When an opponent joins, the derived handicap is capped by this value.
- **Derived settings preview for direct challenges**: When a rated opponent is selected, the frontend computes handicap/komi/color from the rating gap using the same calibration policy logic already available in `rating.ts`. Alternatively, the backend can return preview values in the NewGameData DTO.
- **Opponent list filtering**: For rated direct challenges, the backend returns a filtered list of registered rating-participating users. For unrated, all users are available. The existing `opponent` query parameter in `NewGameQuery` is extended to return a filtered list.
- **Email invite message**: Optional textarea field. If present, included in the invitation email body. The existing email sending infrastructure handles this.

## Phase 1 Design

### Data Model

The existing `Game` struct gains one nullable column:

- `max_handicap INTEGER` — maximum handicap stones the creator accepts for rated open games (NULL when not applicable). Used by `game_joiner` to cap the `derived_handicap` when an opponent joins.

### Contracts

See `contracts/new-game-form-contract.md` for the extended `/api/web/games/new` DTO shape.

### Quickstart

See `quickstart.md` for verification commands and manual test flows.

## Post-Design Constitution Check

- **Simplicity and minimal change**: Pass. One new DB column, one new service parameter, frontend refactor into modules.
- **Layer ownership**: Pass. All changes in `seki-web` only.
- **Server enforcement**: Pass. Ranked constraints unchanged server-side.
- **SPA and JSON contracts**: Pass. Existing SPA shell and `/api/web/games/new` endpoint extended.
- **File and module size**: Pass. Splitting the 769-line form into modules resolves the pre-existing size concern.
- **Tests and documentation**: Pass. Verification commands named; docs to be updated.
