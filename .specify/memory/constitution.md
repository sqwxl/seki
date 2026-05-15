<!--
Sync Impact Report
Version change: 1.1.0 -> 1.2.0
Modified principles:
- None
Added sections:
- None
Removed sections:
- None
Templates requiring updates:
- updated: .specify/templates/plan-template.md
- updated: .specify/templates/spec-template.md
- n/a: .specify/templates/tasks-template.md
- n/a: .specify/templates/commands/*.md (directory not present)
Follow-up TODOs:
- None
-->
# Seki Constitution

## Core Principles

### I. Simplicity and Minimal Change
Changes MUST fight complexity and keep the smallest maintainable diff that
solves the current problem. New abstractions, broad refactors, global mutable
state, and side effects require a concrete benefit that is visible in the
feature plan. Trivial features MUST NOT add outside dependencies. When a
dependency is justified, the plan MUST consider its dependency tree and prefer
the smaller, established option.

Rationale: Seki is a small, full-stack game application where unnecessary
structure quickly makes rules, realtime state, and UI behavior harder to audit.

### II. Domain Logic Belongs in the Right Layer
Game rules, SGF behavior, replay navigation, and scoring logic MUST live in
`go-engine` unless there is a specific boundary reason. `go-engine` MUST remain
pure game logic with no IO and no async. `go-engine-wasm` MUST stay a thin
wasm-bindgen boundary over `go-engine`; it MUST NOT become the source of game
rules. Web business logic belongs in `seki-web/src/services`, persistence in
`seki-web/src/models`, HTTP handlers in `seki-web/src/routes`, and realtime
behavior in `seki-web/src/ws`.

Rationale: Keeping rules reusable and testable prevents browser-only behavior
from diverging from server-side enforcement.

### III. API and Realtime Behavior Are Server-Enforced
Any rule that protects data, validates game actions, enforces access control,
or shapes public API behavior MUST be enforced server-side, even when the
browser UI also validates it. Private and invite-protected games MUST NOT leak
through HTTP or WebSocket clients. Programmatic API behavior MUST use stable
JSON contracts, bearer-token authentication rules, and structured error
envelopes where applicable.

Rationale: Browser controls are convenience only; API and WebSocket clients can
bypass them.

### IV. SPA Shell with JSON Contracts
Seki MUST preserve the SPA shell architecture unless a feature plan documents a
strong reason to change it. Browser routes such as `/games`, `/games/:id`,
`/analysis`, `/users/:username`, `/login`, `/register`, and `/settings` serve
the shared shell. Route-specific data belongs under `/api/web/*`, and
programmatic API routes belong under `/api/*`. New server-rendered
page-specific templates MUST NOT be added without explicit justification.

Rationale: The frontend behavior specification assumes client-side routing,
shared bootstrap data, and JSON-backed page flows.

### V. Tested, Documented, and Traceable Changes
Every feature plan MUST name the relevant verification commands and run the
smallest useful test set after changes. Engine changes require focused Rust
tests; API/service changes require Rust tests or documented manual API checks;
frontend state or utility changes require Vitest or typecheck coverage when
practical. Completed features MUST update associated documentation, including
the `README.md` checklist and any affected behavior in `FRONTEND_SPEC.md` or
`API_SPEC.md`.

Rationale: Manual product specs are the long-lived contract, while Speckit
feature folders are implementation packets.

## Codebase Boundaries

- `README.md` is the high-level feature checklist; checked items are treated as
  implemented behavior.
- `FRONTEND_SPEC.md` defines browser-client behavior and cross-cutting UX rules.
- `API_SPEC.md` defines server-side API, validation, access-control, abuse
  control, deployment-origin, and error-response behavior.
- GitHub issues SHOULD align with unimplemented checklist items, spec gaps, or
  confirmed bugs.
- SQLite is the active database. Runtime migrations live in
  `seki-web/migrations/` and existing migrations MUST NOT be modified. Schema
  changes require a new numbered SQLite migration in that directory.
- `User` means account identity. `Player` means game participant. New code MUST
  keep this naming distinction clear.
- TypeScript code SHOULD use `type` over `interface` and MUST NOT use
  `as unknown as`.
- `Engine::is_legal(point, stone)` takes `Stone` directly. Minimum handicap is
  2 stones. GameState serialization MUST preserve the documented board,
  captures, and ko shape.

## Development Workflow

- Start implementation work with a short plan and keep changes scoped.
- Ask before large refactors or new dependencies.
- Prefer functional, stateless helpers and declarative interfaces with
  imperative implementation details hidden behind them.
- Do not test log output unless the log is the user-visible or contractually
  required behavior.
- When a function starts taking more than four parameters, consider replacing
  the parameter list with an object or domain type.
- Use conventional single-line commit messages unless extra explanation is
  warranted.
- All development MUST happen directly on `main` unless the user explicitly
  requests a different branch workflow for a specific task.

## Governance

This constitution supersedes generated Speckit defaults and guides all future
feature specs, plans, tasks, and implementation reviews. Amendments require a
plain-language explanation, a semantic version bump, and a Sync Impact Report
that lists affected templates and runtime guidance.

Versioning policy:
- MAJOR for removed or redefined principles that change accepted work.
- MINOR for new principles, new sections, or materially expanded guidance.
- PATCH for clarifications, wording fixes, and non-semantic refinements.

Compliance expectations:
- `spec.md` files MUST identify source references from the root product specs
  when adapting manually created requirements.
- `plan.md` files MUST include a Constitution Check covering simplicity,
  layering, server enforcement, SPA/JSON contracts, tests, and documentation.
- `tasks.md` files MUST include verification and documentation tasks when the
  feature changes behavior.
- Review findings and implementation summaries SHOULD cite the relevant file or
  spec section when a constitution principle is at stake.

**Version**: 1.2.0 | **Ratified**: 2026-05-15 | **Last Amended**: 2026-05-15
