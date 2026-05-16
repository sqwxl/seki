# Tasks: Player Rating System

**Input**: Design documents from `specs/001-player-rating-system/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md)

**Tests**: The feature spec and quickstart require focused Rust and frontend verification. Add tests before or alongside the code they validate.

**Organization**: Tasks are grouped by user story so each story can be implemented and tested independently after shared foundation work.

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Add the dependency and empty module/test entry points used by later tasks.

- [X] T001 Add `skillratings` with default features only in `seki-web/Cargo.toml`
- [X] T002 Create rating migration file after `001_initial.sql` in `seki-web/migrations/002_player_ratings.sql`
- [X] T003 [P] Create rating model module stub and export it from `seki-web/src/models/rating.rs` and `seki-web/src/models/mod.rs`
- [X] T004 [P] Create rating service module stub and export it from `seki-web/src/services/rating.rs` and `seki-web/src/services/mod.rs`
- [X] T005 [P] Create frontend rating utility stub in `seki-web/frontend/src/utils/rating.ts`
- [X] T006 [P] Create Rust integration test module for rating flows in `seki-web/tests/ws/rating.rs`
- [X] T007 Register the rating integration test module in `seki-web/tests/ws/main.rs`
- [X] T008 [P] Create frontend rating formatting test file in `seki-web/frontend/src/__tests__/rating-format.test.ts`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Build the shared data model, core rating primitives, and DTO types required by all user stories.

**Critical**: No user story implementation should start until this phase is complete.

- [X] T009 Define `rating_profiles`, `rating_adjustments`, and rated-game snapshot schema with indexes and uniqueness constraints in `seki-web/migrations/002_player_ratings.sql`
- [X] T010 Add ranked status and rating snapshot fields to game row types and game write/read queries in `seki-web/src/models/game.rs`
- [X] T011 Add ranked status and rating snapshot fields to game list read queries in `seki-web/src/models/game_read.rs`
- [X] T012 Implement rating profile and adjustment row/query functions in `seki-web/src/models/rating.rs`
- [X] T013 [P] Add rating DTO structs for shared web/API responses in `seki-web/src/services/rating.rs`
- [X] T014 [P] Implement versioned rating-to-rank calibration policy and provisional default mapping in `seki-web/src/services/rating.rs`
- [X] T015 [P] Implement rank qualifier formatting, uncertainty threshold handling, and alternate display helpers in `seki-web/src/services/rating.rs`
- [X] T016 [P] Implement frontend rating display types and formatting helpers in `seki-web/frontend/src/utils/rating.ts`
- [X] T017 [P] Extend frontend shared game/user types with rank DTO fields in `seki-web/frontend/src/game/types.ts`
- [X] T018 Add unit tests for calibration policy, rank formatting, and uncertainty threshold behavior in `seki-web/src/services/rating.rs`
- [X] T019 Add Vitest coverage for kyu/dan, numeric rating, uncertainty, unranked, and non-participating formatting in `seki-web/frontend/src/__tests__/rating-format.test.ts`

**Checkpoint**: Rating persistence primitives and display primitives exist without changing game behavior.

---

## Phase 3: User Story 1 - Play Ranked Games (Priority: P1) MVP

**Goal**: Registered rating participants can create/join ranked games, receive automatic ranked settings, complete a rated result, and have both Glicko-2 ratings update exactly once.

**Independent Test**: Two registered participating users create and complete a ranked game by resignation; both rating profiles update, uncertainty values update, the game remains ranked, automatic settings are visible, and duplicate finalization does not duplicate adjustments.

### Tests for User Story 1

- [X] T020 [P] [US1] Add integration tests for ranked game creation, private-game rejection, invite-only rejection, and manual handicap/komi rejection in `seki-web/tests/ws/rating.rs`
- [X] T021 [P] [US1] Add integration tests for ranked open-game join snapshot capture and automatic color/handicap/komi derivation in `seki-web/tests/ws/rating.rs`
- [X] T022 [P] [US1] Add integration tests for resignation-triggered Glicko-2 update and idempotent repeated finalization in `seki-web/tests/ws/rating.rs`
- [X] T023 [P] [US1] Add integration tests for exact-rating random color assignment and lower-rating Black assignment in `seki-web/tests/ws/rating.rs`

### Implementation for User Story 1

- [X] T024 [US1] Implement rating eligibility checks for registered users, bots, anonymous users, private games, invite-only games, open games, and direct challenges in `seki-web/src/services/rating.rs`
- [X] T025 [US1] Implement current rating profile creation/defaulting and participation defaults in `seki-web/src/models/rating.rs`
- [X] T026 [US1] Implement Glicko-2 two-player result application and before/after calculation using `skillratings` in `seki-web/src/services/rating.rs`
- [X] T027 [US1] Implement idempotent rating adjustment insertion and `rating_applied` marking in `seki-web/src/models/rating.rs`
- [X] T028 [US1] Implement ranked snapshot capture and automatic handicap/komi/color derivation in `seki-web/src/services/rating.rs`
- [X] T029 [US1] Wire ranked create validation and snapshot initialization into `seki-web/src/services/game_creator.rs`
- [X] T030 [US1] Wire ranked open-game join and challenge acceptance validation into `seki-web/src/services/game_joiner.rs`
- [X] T031 [US1] Reject or ignore manual ranked handicap/komi in web game creation handlers in `seki-web/src/routes/games.rs`
- [X] T032 [US1] Enforce ranked constraints for bearer-token game creation paths in `seki-web/src/routes/api.rs`
- [X] T033 [US1] Call rating finalization from resignation result flow in `seki-web/src/services/game_actions/mod.rs`
- [X] T034 [US1] Call rating finalization from territory/agreed-score result flow in `seki-web/src/services/game_actions/territory.rs`
- [X] T035 [US1] Call rating finalization from timeout/disconnect victory flow in `seki-web/src/services/game_actions/disconnect.rs`
- [X] T036 [US1] Add ranked status, rating snapshots, and derived settings to serialized game state in `seki-web/src/services/state_serializer.rs`
- [X] T037 [US1] Include ranked settings and rank fields in live game websocket messages in `seki-web/src/ws/live.rs`
- [X] T038 [US1] Render ranked choice, unavailable reasons, and numeric pre-game ratings in `seki-web/frontend/src/layouts/game-settings-form.tsx`
- [X] T039 [US1] Render ranked settings and rating fields in live game panels in `seki-web/frontend/src/components/player-panel.tsx`
- [X] T040 [US1] Render ranked status and automatic settings in game info UI in `seki-web/frontend/src/components/game-info.tsx`

**Checkpoint**: User Story 1 is complete and independently testable as the MVP.

---

## Phase 4: User Story 2 - Understand Rank Everywhere (Priority: P2)

**Goal**: Users see consistent rating/rank labels across supported contexts and can choose kyu/dan or numeric rating as the global display mode.

**Independent Test**: Ranked, uncertain, unranked, non-participating, anonymous, and bot users render correctly in user labels, game lists, player panels, game-info popovers, challenge selection, and profile titles with kyu/dan default and alternate hover/accessibility value.

### Tests for User Story 2

- [X] T041 [P] [US2] Create frontend rating preference tests for fallback and persistence behavior in `seki-web/frontend/src/__tests__/rating-preferences.test.ts`
- [X] T042 [P] [US2] Add frontend tests for user-label primary and alternate rating display behavior in `seki-web/frontend/src/__tests__/rating-format.test.ts`
- [X] T043 [P] [US2] Add backend tests for web DTO rank states across ranked, uncertain, unranked, not-participating, anonymous, and bot users in `seki-web/tests/ws/rating.rs`

### Implementation for User Story 2

- [X] T044 [US2] Extend user-facing DTO assembly with rank status, rating, deviation, volatility, uncertainty, and derived qualifier in `seki-web/src/services/rating.rs`
- [X] T045 [US2] Add rank fields to game-list, game-detail, challenge, and profile web API responses in `seki-web/src/routes/web_api.rs`
- [X] T046 [US2] Add rating display preference parsing and defaulting to `kyu_dan` in `seki-web/src/models/user.rs`
- [X] T047 [US2] Add rating display preference patch handling and validation in `seki-web/src/routes/settings.rs`
- [X] T048 [US2] Initialize and save frontend `rating_display` preference in `seki-web/frontend/src/utils/preferences.ts`
- [X] T049 [US2] Extend `UserLabel` props and rendering for rank qualifier, uncertainty marker, and alternate hover/accessibility text in `seki-web/frontend/src/components/user-label.tsx`
- [X] T050 [US2] Render rank labels in game list rows with global display preference in `seki-web/frontend/src/layouts/games-list.tsx`
- [X] T051 [US2] Render rank labels in player panels using shared user-label behavior in `seki-web/frontend/src/components/player-panel.tsx`
- [X] T052 [US2] Render rank labels and unrated status in game info popovers in `seki-web/frontend/src/components/game-info.tsx`
- [X] T053 [US2] Render rating display preference controls in settings/user menu UI in `seki-web/frontend/src/components/user-menu.tsx`
- [X] T054 [US2] Update live websocket rank DTO handling in `seki-web/frontend/src/game/messages.ts`

**Checkpoint**: User Story 2 works independently on existing and newly rated data.

---

## Phase 5: User Story 3 - Choose Rating Participation (Priority: P3)

**Goal**: Registered users can understand and change whether they participate in future ranked games, while existing ranked games keep captured eligibility.

**Independent Test**: Toggling participation updates settings/profile copy, blocks future ranked creation/join when off, shows `(-)` labels, and does not change already-started ranked game treatment.

### Tests for User Story 3

- [ ] T055 [P] [US3] Add backend tests for opt-out blocking ranked create/join and preserving in-progress ranked game eligibility in `seki-web/tests/ws/rating.rs`
- [ ] T056 [P] [US3] Add frontend tests for non-participating label formatting and settings state in `seki-web/frontend/src/__tests__/rating-preferences.test.ts`

### Implementation for User Story 3

- [ ] T057 [US3] Implement participation opt-in/opt-out update query in `seki-web/src/models/rating.rs`
- [ ] T058 [US3] Add participation setting route validation and response payloads in `seki-web/src/routes/settings.rs`
- [ ] T059 [US3] Enforce participation status in ranked create and join eligibility in `seki-web/src/services/rating.rs`
- [ ] T060 [US3] Preserve captured eligibility for already-started ranked games in `seki-web/src/services/rating.rs`
- [ ] T061 [US3] Render participation status and control in settings UI in `seki-web/frontend/src/components/notification-settings.tsx`
- [ ] T062 [US3] Render ranked-unavailable feedback in game creation UI in `seki-web/frontend/src/layouts/game-settings-form.tsx`
- [ ] T063 [US3] Render non-participating `(-)` status consistently in profile and user labels in `seki-web/frontend/src/components/user-label.tsx`

**Checkpoint**: User Story 3 works independently without changing completed rating history.

---

## Phase 6: User Story 4 - Preserve Rating History (Priority: P4)

**Goal**: Rating history is durable, chronological, attached to user identity, and sufficient for future rating graphs without reconstructing from current rating alone.

**Independent Test**: After several ranked games, the profile exposes chronological rating changes with game, result, before/after rating, before/after deviation, before/after volatility, delta, and timestamp, while username changes and opt-out do not detach history.

### Tests for User Story 4

- [ ] T064 [P] [US4] Add backend tests for chronological rating history rows with before/after rating, deviation, volatility, delta, result, and game reference in `seki-web/tests/ws/rating.rs`
- [ ] T065 [P] [US4] Add backend tests for username change and opt-out preserving rating history identity in `seki-web/tests/ws/rating.rs`
- [ ] T066 [P] [US4] Add backend tests for protected private/invite game rating metadata visibility in profile history in `seki-web/tests/ws/rating.rs`

### Implementation for User Story 4

- [ ] T067 [US4] Implement rating history query with protected game visibility filtering in `seki-web/src/models/rating.rs`
- [ ] T068 [US4] Add profile rating summary and history DTO assembly in `seki-web/src/services/rating.rs`
- [ ] T069 [US4] Add profile rating summary and history fields to user route data in `seki-web/src/routes/users.rs`
- [ ] T070 [US4] Add profile rating summary and history fields to `/api/web/users/:username` responses in `seki-web/src/routes/web_api.rs`
- [ ] T071 [US4] Render current rating summary and chronological history on user profile pages in `seki-web/frontend/src/layouts/user-games.tsx`
- [ ] T072 [US4] Ensure registration upgrade and username changes keep rating profile linked by user id in `seki-web/src/models/user.rs`

**Checkpoint**: User Story 4 works independently with historical rating data.

---

## Phase 7: User Story 5 - Find Suitable Games (Priority: P5)

**Goal**: Game browsing distinguishes ranked/unrated games and filters open opportunities by rated status and practical rank range.

**Independent Test**: A mixed lobby of ranked and unrated games across rank ranges can be filtered by rated status and opponent rank range within the expected response time.

### Tests for User Story 5

- [ ] T073 [P] [US5] Add backend tests for rated/unrated and rank-range game list filtering in `seki-web/tests/ws/rating.rs`
- [ ] T074 [P] [US5] Add frontend tests for rating filter state and display behavior in `seki-web/frontend/src/__tests__/rating-format.test.ts`

### Implementation for User Story 5

- [ ] T075 [US5] Extend game list query parameters and filtering by ranked status and rating/rank range in `seki-web/src/models/game_read.rs`
- [ ] T076 [US5] Add rated-status and rank-range parsing to games web API route in `seki-web/src/routes/web_api.rs`
- [ ] T077 [US5] Include ranked status, rank labels, and `(unrated)` display data in game list DTOs in `seki-web/src/services/live.rs`
- [ ] T078 [US5] Add rated/unrated and rank-range filter controls in `seki-web/frontend/src/layouts/games-list.tsx`
- [ ] T079 [US5] Persist game-list rating filter state in `seki-web/frontend/src/utils/storage.ts`

**Checkpoint**: User Story 5 works independently on top of existing game-list data.

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: Final verification, documentation, and cleanup across all stories.

- [ ] T080 [P] Update rating-system implementation notes and checklist items in `README.md`
- [ ] T081 [P] Update frontend behavior contract for rating labels, display preference, and ranked game UI in `FRONTEND_SPEC.md`
- [ ] T082 [P] Update API behavior contract for ranked game validation and rating response fields in `API_SPEC.md`
- [ ] T083 Run Rust verification commands and record results in `specs/001-player-rating-system/quickstart.md`
- [ ] T084 Run frontend typecheck/tests and record results in `specs/001-player-rating-system/quickstart.md`
- [ ] T085 Review rating service and route changes for protected game metadata leaks in `seki-web/src/services/rating.rs`
- [ ] T086 Review generated OpenAPI output for rating fields and API errors in `seki-web/src/bin/gen-openapi.rs`
- [ ] T087 Split `seki-web/src/services/rating.rs` into focused modules if it grows beyond roughly 500 lines in `seki-web/src/services/rating.rs`
- [ ] T088 Split `seki-web/src/models/rating.rs` into focused modules if it grows beyond roughly 500 lines in `seki-web/src/models/rating.rs`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 Setup**: No dependencies.
- **Phase 2 Foundational**: Depends on Phase 1 and blocks all user stories.
- **Phase 3 US1**: Depends on Phase 2 and is the MVP.
- **Phase 4 US2**: Depends on Phase 2; can use seeded rating data before US1 is complete, but product integration is clearer after US1 DTOs settle.
- **Phase 5 US3**: Depends on Phase 2 and benefits from US2 label display, but participation enforcement is independently testable.
- **Phase 6 US4**: Depends on Phase 2 and uses US1 adjustment history for end-to-end validation.
- **Phase 7 US5**: Depends on Phase 2 and benefits from US2 display helpers.
- **Phase 8 Polish**: Depends on completed desired stories.

### User Story Dependencies

- **US1 Play Ranked Games**: MVP; no dependency on other stories after foundation.
- **US2 Understand Rank Everywhere**: Needs foundational rank DTO/formatting helpers; can render seeded data before US1 is complete.
- **US3 Choose Rating Participation**: Needs rating profile foundation; UI display is clearer after US2.
- **US4 Preserve Rating History**: Needs US1 result adjustment rows for end-to-end validation.
- **US5 Find Suitable Games**: Needs rank DTOs and game-list rating fields; can use seeded data for independent tests.

### Within Each User Story

- Test tasks come before implementation tasks.
- Model tasks come before service tasks.
- Service tasks come before route/websocket tasks.
- Backend DTO tasks come before frontend rendering tasks.
- Each story checkpoint should pass before moving to the next priority story in a single-developer flow.

---

## Parallel Opportunities

- T003, T004, T005, T006, and T008 can run in parallel after T001 and T002 are understood.
- T013, T014, T015, T016, and T017 can run in parallel after T009-T012 define the persistence boundary.
- US1 test tasks T020-T023 can run in parallel.
- US2 test tasks T041-T043 can run in parallel.
- US3 test tasks T055-T056 can run in parallel.
- US4 test tasks T064-T066 can run in parallel.
- US5 test tasks T073-T074 can run in parallel.
- Documentation tasks T080-T082 can run in parallel after implementation behavior stabilizes.

## Parallel Example: User Story 1

```bash
Task: "T020 Add integration tests for ranked game creation, private-game rejection, invite-only rejection, and manual handicap/komi rejection in seki-web/tests/ws/rating.rs"
Task: "T021 Add integration tests for ranked open-game join snapshot capture and automatic color/handicap/komi derivation in seki-web/tests/ws/rating.rs"
Task: "T022 Add integration tests for resignation-triggered Glicko-2 update and idempotent repeated finalization in seki-web/tests/ws/rating.rs"
Task: "T023 Add integration tests for exact-rating random color assignment and lower-rating Black assignment in seki-web/tests/ws/rating.rs"
```

## Parallel Example: User Story 2

```bash
Task: "T041 Create frontend rating preference tests for fallback and persistence behavior in seki-web/frontend/src/__tests__/rating-preferences.test.ts"
Task: "T042 Add frontend tests for user-label primary and alternate rating display behavior in seki-web/frontend/src/__tests__/rating-format.test.ts"
Task: "T043 Add backend tests for web DTO rank states across ranked, uncertain, unranked, not-participating, anonymous, and bot users in seki-web/tests/ws/rating.rs"
```

## Parallel Example: User Story 4

```bash
Task: "T064 Add backend tests for chronological rating history rows with before/after rating, deviation, volatility, delta, result, and game reference in seki-web/tests/ws/rating.rs"
Task: "T065 Add backend tests for username change and opt-out preserving rating history identity in seki-web/tests/ws/rating.rs"
Task: "T066 Add backend tests for protected private/invite game rating metadata visibility in profile history in seki-web/tests/ws/rating.rs"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1 setup.
2. Complete Phase 2 foundation.
3. Complete Phase 3 US1.
4. Validate ranked create/join/result flow with `cargo test -p seki-web rating`.
5. Stop and review the data model before adding wider UI display.

### Incremental Delivery

1. Add US1 for correct rating outcomes.
2. Add US2 for broad display and user preference.
3. Add US3 for participation controls.
4. Add US4 for profile history.
5. Add US5 for game discovery filters.
6. Finish with documentation and full verification.

### Single-Developer Strategy

Work in priority order because later stories reuse US1 adjustment data and US2 display helpers. Keep commits grouped by completed phase or story when commits are requested.

---

## Notes

- [P] tasks are parallelizable only when they touch different files or do not depend on incomplete task output.
- Kyu/dan labels and handicap-step counts are presentation/policy outputs; do not persist them as authoritative rating state.
- Glicko-2 rating, deviation, volatility, and rating history are authoritative persisted data.
- Do not modify `go-engine` or `go-engine-wasm` for this feature.
- Use new numbered migrations only; never modify `seki-web/migrations/001_initial.sql`.
