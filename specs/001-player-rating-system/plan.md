# Implementation Plan: Player Rating System

**Branch**: `main` unless explicitly requested otherwise | **Date**: 2026-05-15 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/001-player-rating-system/spec.md`

## Summary

Add a server-enforced ranked-game and player rating system to `seki-web` using Glicko-2 via the zero-default-dependency `skillratings` crate. Persist current rating state and append-only rating history, derive kyu/dan labels through a configurable versioned calibration policy, derive ranked handicap/komi/color from numeric rating context, and expose rank display through existing SPA JSON, API, websocket, and frontend user-label flows.

## Technical Context

**Language/Version**: Rust edition 2024 for backend; TypeScript with Preact 10 for frontend

**Primary Dependencies**: Axum 0.8, sqlx 0.8 SQLite, tower-sessions 0.14, Preact 10, Vitest, `skillratings` for Glicko-2 with default features only

**Storage**: SQLite via sqlx 0.8; add new numbered migrations only

**Testing**: `cargo test -p seki-web`, `cargo check --all`, `pnpm run typecheck`, `pnpm test`

**Target Platform**: Linux-hosted Axum web service with browser SPA frontend

**Project Type**: Full-stack web application inside existing Cargo workspace

**Performance Goals**: Rating label and game-list DTO generation should remain within existing page-load expectations; game-list filtering by rated status and rank range must return within 1 second for typical lobby sizes.

**Constraints**: Rating and ranked-game validation must be enforced server-side; no `go-engine` or `go-engine-wasm` changes; do not persist kyu/dan labels as rating state; private and invite-protected games must not leak rating metadata; first version uses immediate per-game Glicko-2 updates, not batch rating periods; source modules should remain around 500 lines or less unless cohesive and explicitly justified.

**Scale/Scope**: First version covers two-player games, current/profile rating display, ranked game creation/join/result flows, durable rating history, and game-list filtering. Bot calibration of the rating-to-rank policy is expected later and is out of scope.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **Simplicity and minimal change**: Pass. The plan adds one justified dependency, `skillratings`, to avoid implementing Glicko-2. The rating-to-rank calibration policy stays as a small service-level policy boundary, not a generalized rules engine.
- **Layer ownership**: Pass. Rating calculations, eligibility, ranked settings, and DTO helpers belong in `seki-web/src/services`; persistence belongs in `seki-web/src/models` and migrations; HTTP/API behavior belongs in `routes`; realtime DTO propagation belongs in `ws`; frontend display belongs in existing Preact modules. `go-engine` and `go-engine-wasm` remain unchanged.
- **Server enforcement**: Pass. Ranked eligibility, private-game rejection, manual handicap/komi rejection, idempotent result application, and protected rating-history visibility are all enforced in backend services/routes.
- **SPA and JSON contracts**: Pass. Browser routes continue to serve the SPA shell. New route data is exposed through existing `/api/web/*`, `/api/*`, and websocket DTOs.
- **File and module size**: Pass. Rating work is planned as focused modules: `models/rating.rs` for persistence, `services/rating.rs` for orchestration/DTOs, and smaller concern modules if either approaches 500 lines during implementation. Frontend rating formatting belongs in `utils/rating.ts` so existing UI files do not absorb formatting policy.
- **Tests and documentation**: Pass. Verification will include focused Rust service/model tests, frontend utility/component tests or typecheck, and updates to `README.md`, `FRONTEND_SPEC.md`, and `API_SPEC.md` when implementation is complete.

## Project Structure

### Documentation (this feature)

```text
specs/001-player-rating-system/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── rating-api-contract.md
│   └── rating-web-contract.md
└── tasks.md
```

### Source Code (repository root)

```text
seki-web/
├── Cargo.toml            # Add skillratings with default features only
├── migrations/           # Add new rating/ranked-game migration
├── src/
│   ├── models/
│   │   └── rating.rs     # Rating profile, snapshot, adjustment queries
│   ├── services/
│   │   └── rating.rs     # Rating service, eligibility, Glicko-2, calibration, DTO helpers
│   ├── routes/           # Web/API game creation, join, profile, settings data
│   └── ws/               # Lobby/game updates containing rating fields
└── frontend/src/
    ├── components/       # User labels, player panels, game info controls
    ├── layouts/          # Games list, game creation/settings, profiles
    ├── game/             # Live game DTO handling
    ├── utils/
    │   └── rating.ts     # Rating formatting and display preference helpers
    └── __tests__/        # Focused rating formatting/state tests
```

**Structure Decision**: Keep all rating behavior in `seki-web`. The feature is web-domain state around game outcomes and user presentation, not Go engine logic. If `services/rating.rs` grows beyond roughly 500 lines, split it by concern into modules such as eligibility, calculation, calibration, and DTO assembly under `seki-web/src/services/rating/`. If `models/rating.rs` grows beyond roughly 500 lines, split query groups by profile, snapshot, and adjustment persistence under `seki-web/src/models/rating/`.

## Complexity Tracking

No constitution violations.

## Phase 0 Research

Completed in [research.md](./research.md). Key decisions:

- Use Glicko-2 via `skillratings`.
- Store current Glicko-2 state separately from append-only adjustment history.
- Use rating deviation as the uncertainty signal, with `?` while deviation is greater than 110.
- Apply ratings immediately and idempotently from a single rating service after terminal ranked results.
- Capture game-bound numeric rating snapshots and derive presentation labels from those snapshots.
- Use a configurable, versioned rating-to-rank calibration policy for kyu/dan labels and handicap-step counts.
- Keep bot calibration out of the first version while designing the policy boundary so calibration can change later without rewriting rating history.

## Phase 1 Design

Completed artifacts:

- [data-model.md](./data-model.md)
- [contracts/rating-web-contract.md](./contracts/rating-web-contract.md)
- [contracts/rating-api-contract.md](./contracts/rating-api-contract.md)
- [quickstart.md](./quickstart.md)

## Post-Design Constitution Check

- **Simplicity and minimal change**: Pass. Design keeps one new dependency and one bounded calibration policy. Kyu/dan remains derived presentation, avoiding duplicated persisted rank state.
- **Layer ownership**: Pass. Data model and contracts keep rating in `seki-web`; no engine/WASM changes are required.
- **Server enforcement**: Pass. Contracts require backend rejection/enforcement for ranked constraints and protected visibility.
- **SPA and JSON contracts**: Pass. Contracts extend existing SPA JSON/API/websocket shapes.
- **File and module size**: Pass. Design artifacts isolate rating persistence, service logic, and frontend formatting into purpose-specific files and identify splits if implementation files grow past the 500-line guideline.
- **Tests and documentation**: Pass. Quickstart names Rust and frontend verification commands plus product-spec documentation updates.
