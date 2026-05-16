# Tasks: Ranked Game Form Redesign

**Input**: Design documents from `specs/003-ranked-game-form/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md)

**Tests**: The spec requires focused Rust tests for the new `max_handicap` parameter and frontend tests for variant switching and rated/unrated gating. Add tests before or alongside the code they validate.

**File size**: The existing `game-settings-form.tsx` (~769 lines) must be split into an orchestrator and three variant modules as part of this feature.

**Organization**: Tasks are grouped by user story so each story can be implemented and tested independently after shared foundation work.

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Add the `max_handicap` DB column and extend backend structs used by all user stories.

- [ ] T001 Create migration `seki-web/migrations/003_max_handicap.sql` adding `max_handicap INTEGER` to `games`
- [ ] T002 [P] Add `max_handicap` field to `Game` struct and `RankedGameSnapshotUpdate` struct in `seki-web/src/models/game.rs`
- [ ] T003 [P] Add `max_handicap` to `Game::create` SQL INSERT in `seki-web/src/models/game.rs`
- [ ] T004 [P] Add `max_handicap` field to `CreateGameParams` in `seki-web/src/services/game_creator.rs`
- [ ] T005 Pass `params.max_handicap` through to `Game::create` in `seki-web/src/services/game_creator.rs`
- [ ] T006 Add `max_handicap` parameter to the web form handler in `seki-web/src/routes/games.rs`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Split the monolithic game settings form into an orchestrator and variant modules. Extend the `/api/web/games/new` DTO — the shared scaffolding all user stories depend on.

**Critical**: No user story implementation should start until this phase is complete.

- [ ] T007 Split `seki-web/frontend/src/layouts/game-settings-form.tsx` into orchestrator (`form-orchestrator.tsx`) that handles variant selection, shared state, and form submission
- [ ] T008 [P] Create stub variant module `seki-web/frontend/src/layouts/form-variants/open-game.tsx` exporting a component accepting Rated/Unrated toggle and rendering the appropriate settings fields
- [ ] T009 [P] Create stub variant module `seki-web/frontend/src/layouts/form-variants/direct-challenge.tsx` exporting a component accepting Rated/Unrated toggle and opponent selection
- [ ] T010 [P] Create stub variant module `seki-web/frontend/src/layouts/form-variants/email-invite.tsx` exporting a component with email input and optional message
- [ ] T011 Add `eligible_opponents` field to `NewGameData` DTO in `seki-web/src/routes/web_api.rs` and populate it with filtered opponent list for direct challenges
- [ ] T012 Extend frontend `NewGameData` type with `eligible_opponents` and rating fields in `seki-web/frontend/src/layouts/game-settings-form.tsx` (or `form-orchestrator.tsx`)

**Checkpoint**: Form is split into modules; backend DTO is extended with opponent list.

---

## Phase 3: User Story 1 - Create an Open Ranked Game (Priority: P1) MVP

**Goal**: A registered rating participant selects "Open game", checks "Rated", sees a 19×19 locked board and max handicap slider, and submits. The game is created as ranked open with the max handicap constraint.

**Independent Test**: Create open ranked game with max handicap 4. Join it with an opponent. Confirm game is 19×19 ranked with handicap capped at 4.

### Implementation for User Story 1

- [ ] T013 [US1] Implement rated/unrated toggle gating in `seki-web/frontend/src/layouts/form-variants/open-game.tsx` (when Rated: lock board to 19×19, hide komi/color, show max handicap slider 0–9)
- [ ] T014 [US1] Implement unrated mode in `seki-web/frontend/src/layouts/form-variants/open-game.tsx` (when Unrated: all settings editable, existing behaviour)
- [ ] T015 [US1] Implement variant selection radio group (Open game / Direct challenge / Email invite) in `seki-web/frontend/src/layouts/form-orchestrator.tsx`
- [ ] T016 [US1] Wire form submission to include `variant` and `max_handicap` fields in `seki-web/frontend/src/layouts/form-orchestrator.tsx`
- [ ] T017 [US1] Add `max_handicap` to `CreateGameForm` and parse it in `seki-web/src/routes/games.rs` (only when variant=open and rated=true)
- [ ] T018 [US1] Cap derived handicap by `game.max_handicap` when joining a rated open game in `seki-web/src/services/game_joiner.rs`
- [ ] T019 [US1] Add backend integration test for max_handicap capping during join in `seki-web/tests/ws/rating.rs`

**Checkpoint**: User Story 1 is complete — rated open games can be created with max handicap constraint.

---

## Phase 4: User Story 2 - Challenge a Ranked Opponent Directly (Priority: P1)

**Goal**: A registered rating participant selects "Direct challenge", checks "Rated", picks an opponent from a filtered list, sees derived settings as read-only preview, and submits.

**Independent Test**: Challenge a specific opponent to a rated game. Confirm derived handicap/komi/color are shown as read-only on the form and used at game creation.

### Implementation for User Story 2

- [ ] T020 [US2] Implement rated direct challenge form in `seki-web/frontend/src/layouts/form-variants/direct-challenge.tsx` — filtered opponent list, derived settings preview (disabled read-only fields for handicap/komi/color)
- [ ] T021 [US2] Implement unrated direct challenge form in `seki-web/frontend/src/layouts/form-variants/direct-challenge.tsx` — full opponent list, all settings editable
- [ ] T022 [US2] Add derived settings preview computation using calibration policy in `seki-web/frontend/src/utils/rating.ts` (export a `ranked_settings_preview` helper taking two rating values and returning handicap/komi/color)
- [ ] T023 [US2] Populate `eligible_opponents` in the backend `load_new_game` handler in `seki-web/src/routes/web_api.rs` — filter by rating participation when `can_create_ranked` is true
- [ ] T024 [US2] Wire direct challenge form submission to include `variant=challenge` and `invite_username` in `seki-web/frontend/src/layouts/form-orchestrator.tsx`
- [ ] T025 [US2] Update `POST /games` handler in `seki-web/src/routes/games.rs` to parse `variant=challenge` and invoke the existing challenge creation path
- [ ] T026 [US2] Add frontend tests for rated direct challenge derived settings preview in `seki-web/frontend/src/__tests__/rating-format.test.ts`

**Checkpoint**: User Story 2 is complete — rated direct challenges show derived settings preview and use them at creation.

---

## Phase 5: User Story 3 - Invite by Email (Unrated Only) (Priority: P2)

**Goal**: A user selects "Email invite", sees a disabled Rated checkbox, enters email and optional message, configures standard unranked settings, and submits.

**Independent Test**: Select Email invite variant. Confirm Rated is disabled and unchecked. Enter an email address and optional message. Submit and confirm invite-only unranked game is created and email is queued.

### Implementation for User Story 3

- [ ] T027 [US3] Implement email invite form in `seki-web/frontend/src/layouts/form-variants/email-invite.tsx` — disabled Rated checkbox, email input, optional message textarea, full unranked settings
- [ ] T028 [US3] Add client-side email validation in `seki-web/frontend/src/layouts/form-variants/email-invite.tsx` (non-empty, basic format check)
- [ ] T029 [US3] Wire email invite form submission to include `variant=email`, `invite_email`, and optional `invite_message` in `seki-web/frontend/src/layouts/form-orchestrator.tsx`
- [ ] T030 [US3] Update `POST /games` handler in `seki-web/src/routes/games.rs` to parse `variant=email`, enforce unrated, and pass `invite_message` to the email infrastructure
- [ ] T031 [US3] Add optional `invite_message` field to `CreateGameParams` and pass it through to the email send logic in `seki-web/src/services/game_creator.rs`

**Checkpoint**: User Story 3 is complete — email invites always create unrated invite-only games with optional message.

---

## Phase 6: User Story 4 - Unranked Open Game (Priority: P3)

**Goal**: An unregistered or non-participating user can create an unranked open game with all settings editable, matching the existing form behaviour.

**Independent Test**: Anonymous user opens new game form, selects Open game, confirms Rated is disabled/unchecked, configures custom settings, and submits successfully.

### Implementation for User Story 4

- [ ] T032 [US4] Disable Rated checkbox with tooltip for unregistered and non-participating users in `seki-web/frontend/src/layouts/form-variants/open-game.tsx` (reuse existing `rankedUnavailableReason`)
- [ ] T033 [US4] Disable Rated checkbox with tooltip for unregistered and non-participating users in `seki-web/frontend/src/layouts/form-variants/direct-challenge.tsx`
- [ ] T034 [US4] Ensure unranked open game creation works identically to existing behaviour through the new form structure in `seki-web/src/routes/games.rs`

**Checkpoint**: User Story 4 is complete — unranked games work for all user types through the new form.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Final verification, documentation, and cleanup across all stories.

- [ ] T035 [P] Remove dead code from original monolithic `seki-web/frontend/src/layouts/game-settings-form.tsx` (old opponent mode fieldsets, ranked checkbox outside variant scope)
- [ ] T036 [P] Update `FRONTEND_SPEC.md` game creation section to document variant-based form structure and rated/unrated gating
- [ ] T037 [P] Update `README.md` checklist if any items changed
- [ ] T038 [P] Add frontend integration test for variant switching and form state reset in `seki-web/frontend/src/__tests__/game-settings-form.test.ts`
- [ ] T039 Run `cargo test -p seki-web` and verify all tests pass
- [ ] T040 Run `pnpm run typecheck && pnpm test` in `seki-web/frontend/` and verify all tests pass
- [ ] T041 Record verification results in `specs/003-ranked-game-form/quickstart.md`
- [ ] T042 Run through the 7 manual checks in quickstart.md and document outcomes

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 Setup**: No dependencies.
- **Phase 2 Foundational**: Depends on Phase 1 and blocks all user stories.
- **Phase 3 US1**: Depends on Phase 2. MVP.
- **Phase 4 US2**: Depends on Phase 2. Uses the same form orchestrator and variant structure. Can start in parallel with US1.
- **Phase 5 US3**: Depends on Phase 2. Independent of US1/US2.
- **Phase 6 US4**: Depends on Phase 2. Adds gating logic on top of US1/US2 forms.
- **Phase 7 Polish**: Depends on all desired stories being complete.

### User Story Dependencies

- **US1 Open Ranked Game**: MVP; no dependency on other stories after foundation.
- **US2 Direct Ranked Challenge**: Independent of US1 after foundation.
- **US3 Email Invite**: Independent of US1/US2 after foundation.
- **US4 Unranked Open Game**: Modifies the forms built in US1/US2, so best done after US1 and US2.

### Within Each User Story

- Backend DTO/params tasks come before frontend rendering tasks.
- Form variant tasks come before orchestrator wiring tasks.
- Each story checkpoint should pass before moving to the next priority story in a single-developer flow.

---

## Parallel Opportunities

- T002, T003, T004 can run in parallel after T001 is understood.
- T008, T009, T010 (stub variant modules) can run in parallel.
- US1, US2, and US3 can be developed in parallel after Phase 2 (different files, independent stories).
- Documentation tasks T035, T036, T037 can run in parallel after implementation behaviour stabilizes.

## Parallel Example: User Story 1 and User Story 2

```bash
# After Phase 2 foundation, these can run in parallel:
# Developer A:
Task: "T013 [US1] Implement rated/unrated toggle gating in form-variants/open-game.tsx"
Task: "T014 [US1] Implement unrated mode in form-variants/open-game.tsx"

# Developer B:
Task: "T020 [US2] Implement rated direct challenge form in form-variants/direct-challenge.tsx"
Task: "T021 [US2] Implement unrated direct challenge form in form-variants/direct-challenge.tsx"
Task: "T022 [US2] Add derived settings preview computation in utils/rating.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1 setup.
2. Complete Phase 2 foundation (file split + DTO).
3. Complete Phase 3 US1.
4. Validate rated open game creation, max handicap capping.
5. Stop and review the form structure before adding more variants.

### Incremental Delivery

1. Add US1 for rated open games.
2. Add US2 for rated direct challenges with preview.
3. Add US3 for email invites (always unrated).
4. Add US4 for unranked access control gating.
5. Finish with documentation and verification.

### Single-Developer Strategy

Work in priority order (US1 → US2 → US3 → US4) because US4 modifies forms built in US1/US2. US3 is independent but lower priority.

---

## Notes

- [P] tasks are parallelizable only when they touch different files or do not depend on incomplete task output.
- Do not modify `go-engine` or `go-engine-wasm` for this feature.
- Use new numbered migrations only; never modify existing migration files.
- The existing `game-settings-form.tsx` should become the orchestrator (`form-orchestrator.tsx`) or be replaced by it. Remove dead code in Phase 7.
- The `eligible_opponents` DTO field should exclude the current user from the opponent list.
- Email invite games must never be rated — enforce this server-side in `POST /games`.
