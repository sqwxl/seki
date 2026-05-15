# Implementation Plan: [FEATURE]

**Branch**: `main` unless explicitly requested otherwise | **Date**: [DATE] | **Spec**: [link]

**Input**: Feature specification from `/specs/[###-feature-name]/spec.md`

**Note**: This template is filled in by the `/speckit-plan` command. See `.specify/templates/plan-template.md` for the execution workflow.

## Summary

[Extract from feature spec: primary requirement + technical approach from research]

## Technical Context

<!--
  ACTION REQUIRED: Replace the content in this section with the technical details
  for the project. The structure here is presented in advisory capacity to guide
  the iteration process.
-->

**Language/Version**: [e.g., Python 3.11, Swift 5.9, Rust 1.75 or NEEDS CLARIFICATION]

**Primary Dependencies**: [e.g., FastAPI, UIKit, LLVM or NEEDS CLARIFICATION]

**Storage**: SQLite via sqlx 0.8, or N/A if this feature does not persist data

**Testing**: [e.g., pytest, XCTest, cargo test or NEEDS CLARIFICATION]

**Target Platform**: [e.g., Linux server, iOS 15+, WASM or NEEDS CLARIFICATION]

**Project Type**: [e.g., library/cli/web-service/mobile-app/compiler/desktop-app or NEEDS CLARIFICATION]

**Performance Goals**: [domain-specific, e.g., 1000 req/s, 10k lines/sec, 60 fps or NEEDS CLARIFICATION]

**Constraints**: [domain-specific, e.g., <200ms p95, <100MB memory, offline-capable or NEEDS CLARIFICATION]

**Scale/Scope**: [domain-specific, e.g., 10k users, 1M LOC, 50 screens or NEEDS CLARIFICATION]

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **Simplicity and minimal change**: [Confirm the plan avoids unnecessary
  abstractions, broad refactors, and trivial new dependencies]
- **Layer ownership**: [Identify whether changes belong in `go-engine`,
  `go-engine-wasm`, `seki-web/src/services`, `models`, `routes`, `ws`, or
  frontend modules, and confirm no logic is placed in the wrong layer]
- **Server enforcement**: [For validation, access control, API behavior, or
  realtime behavior, confirm enforcement happens server-side]
- **SPA and JSON contracts**: [Confirm browser routes keep using the SPA shell
  and route data stays under `/api/web/*` unless justified]
- **Tests and documentation**: [List focused verification commands and affected
  docs/checklists: `README.md`, `FRONTEND_SPEC.md`, `API_SPEC.md`]

## Project Structure

### Documentation (this feature)

```text
specs/[###-feature]/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md        # Phase 1 output (/speckit-plan command)
├── quickstart.md        # Phase 1 output (/speckit-plan command)
├── contracts/           # Phase 1 output (/speckit-plan command)
└── tasks.md             # Phase 2 output (/speckit-tasks command - NOT created by /speckit-plan)
```

### Source Code (repository root)
<!--
  ACTION REQUIRED: Replace the placeholder tree below with the concrete layout
  for this feature. Delete unused options and expand the chosen structure with
  real paths (e.g., apps/admin, packages/something). The delivered plan must
  not include Option labels.
-->

```text
go-engine/
└── src/                  # Pure game logic, SGF, game tree, scoring

go-engine-wasm/
└── src/                  # Thin wasm-bindgen boundary over go-engine

seki-web/
├── migrations/           # SQLite migrations; add new numbered files only
├── src/
│   ├── models/           # sqlx-backed database access and row types
│   ├── services/         # Business logic and game workflows
│   ├── routes/           # HTTP/API handlers and SPA shell delivery
│   ├── ws/               # WebSocket registry, rooms, presence
│   └── templates/        # Shared SPA shell/bootstrap only
└── frontend/src/
    ├── game/             # Live game state and websocket handling
    ├── goban/            # Board rendering and WASM bridge
    ├── components/       # Reusable Preact UI
    ├── layouts/          # Route-level screens
    ├── utils/            # Stateless browser helpers
    └── __tests__/        # Vitest tests
```

**Structure Decision**: [Document the selected structure and reference the real
directories captured above]

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| [e.g., 4th project] | [current need] | [why 3 projects insufficient] |
| [e.g., Repository pattern] | [specific problem] | [why direct DB access insufficient] |
