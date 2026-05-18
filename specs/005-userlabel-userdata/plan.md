# Implementation Plan: UserLabel UserData Refactor

**Branch**: `main` unless explicitly requested otherwise | **Date**: 2026-05-18 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/005-userlabel-userdata/spec.md`

## Summary

Refactor the shared user-label presentation so first-party user contexts pass structured `UserData` into `UserLabel`, while context-specific rendering is controlled by explicit options. Start with the `UserLabel` API itself, then update call sites and the few first-party data contracts that currently expose only primitive user fields. Preserve current user-facing label behavior for player panels, game lists, chat, challenge search, profile-related surfaces, and compact title-like labels.

Existing TODO/FIXME comments in relevant frontend files are part of the implementation discovery surface, especially `components/user-label.tsx`, `components/chat.tsx`, and `layouts/form-variants/shared.tsx`.

## Technical Context

**Language/Version**: TypeScript with Preact 10 in `seki-web/frontend`; Rust 2024/Axum 0.8 only if first-party web data contracts need shape updates

**Primary Dependencies**: Existing Preact frontend, existing `UserData`/`RankData` types, existing `UserRank`, existing `/api/web/*` and bootstrap data shapes; no new dependencies

**Storage**: N/A; this feature does not persist new data or require migrations

**Testing**: `pnpm run typecheck`, focused `pnpm test` for frontend state/component helpers when available, and `pnpm run build`; `cargo test -p seki-web` only if Rust web data serializers/routes change

**Target Platform**: Browser SPA served by `seki-web`

**Project Type**: Web application frontend refactor with narrow first-party JSON contract adjustments as needed

**Performance Goals**: User-label rendering remains lightweight enough for list, chat, and game panels; no additional network round trips just to render labels

**Constraints**: Minimal diff, no new dependency, do not introduce page-specific server-rendered templates, do not fabricate partial user data at call sites, keep context options explicit and typed

**Scale/Scope**: Shared identity display across existing user-label call sites in frontend components/layouts; includes known TODO/FIXME sites and any data-contract gaps found during call-site migration

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **Simplicity and minimal change**: PASS. The plan changes the existing shared component API and its callers instead of introducing a new identity-display abstraction or dependency.
- **Layer ownership**: PASS. Presentation logic belongs in `seki-web/frontend/src/components/user-label.tsx` and nearby frontend call sites. First-party data shape fixes, if required, belong in existing `seki-web/src/routes`/service data assembly for `/api/web/*` or bootstrap payloads. No `go-engine` or `go-engine-wasm` changes are planned.
- **Server enforcement**: PASS. This feature does not change authorization, access control, game actions, or realtime enforcement. Existing server visibility filtering must remain unchanged if response shapes are expanded.
- **SPA and JSON contracts**: PASS. Browser routes continue to serve the SPA shell. Any data additions stay in existing first-party JSON/bootstrap contracts and do not create page-specific templates.
- **File and module size**: PASS WITH WATCH. `layouts/form-variants/shared.tsx` is already large; implementation should keep changes local and split helper functions only if the file grows further or concerns become mixed. `UserLabel` API changes should stay small and cohesive.
- **Tests and documentation**: PASS. Verification should include frontend typecheck/build and focused Vitest coverage if label helpers are added. Update `FRONTEND_SPEC.md` only if implementation changes documented label behavior; otherwise the feature spec and plan are sufficient.

## Project Structure

### Documentation (this feature)

```text
specs/005-userlabel-userdata/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── user-label-contract.md
└── tasks.md
```

### Source Code (repository root)

```text
seki-web/
├── src/
│   ├── routes/           # Only touched if first-party web data contracts need complete user data
│   ├── services/         # Only touched if route payload assembly needs shared user-data shaping
│   └── templates/        # Only touched if bootstrap user data shape must stay aligned
└── frontend/src/
    ├── components/
    │   ├── user-label.tsx       # First implementation step: API and rendering options
    │   ├── user-rank.tsx        # Reused by UserLabel; avoid broad changes unless needed
    │   ├── chat.tsx             # Known FIXME for message user data
    │   ├── player-panel.tsx     # Should pass UserData plus context options
    │   └── game-description.tsx # Game/list label contexts
    ├── layouts/
    │   └── form-variants/shared.tsx # Known FIXME for challenge/search UserData
    └── game/
        ├── types.ts             # Shared UserData and message/data types
        └── capabilities/        # Player-panel derivation and presence inputs
```

**Structure Decision**: Keep the refactor in existing frontend component/layout modules. If a user-label option mapper becomes non-trivial, add a small helper in `components/user-label.tsx` or a sibling file only after the API shape proves it reduces caller complexity.

## Phase 0: Research

See [research.md](./research.md).

## Phase 1: Design and Contracts

See [data-model.md](./data-model.md), [contracts/user-label-contract.md](./contracts/user-label-contract.md), and [quickstart.md](./quickstart.md).

## Post-Design Constitution Check

- **Simplicity and minimal change**: PASS. Design keeps one reusable `UserLabel` and explicit options rather than adding a second component family.
- **Layer ownership**: PASS. Data-contract fixes are limited to first-party user payloads; rendering behavior remains frontend-owned.
- **Server enforcement**: PASS. No enforcement behavior changes.
- **SPA and JSON contracts**: PASS. Existing SPA and JSON flow remains intact.
- **File and module size**: PASS WITH WATCH. Implementation tasks should inspect `shared.tsx` size before adding more logic and prefer small helpers if needed.
- **Tests and documentation**: PASS. Quickstart names frontend verification and conditional Rust verification for any response-shape changes.

## Complexity Tracking

No constitution violations require justification.
