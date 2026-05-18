# Tasks: UserLabel UserData Refactor

**Input**: Design documents from `specs/005-userlabel-userdata/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/user-label-contract.md](./contracts/user-label-contract.md), [quickstart.md](./quickstart.md)

**Tests**: Include focused frontend coverage only where small helpers or option behavior are introduced; always run typecheck/build verification.

**File size**: `seki-web/frontend/src/layouts/form-variants/shared.tsx` is already over 500 lines, so tasks touching it should stay tightly scoped and extract a small helper only if needed for clarity.

**Organization**: Tasks are grouped by user story so each story can be implemented and checked independently after the foundational `UserLabel` API work.

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Establish the current refactor surface and verification path.

- [x] T001 Review existing `UserLabel` usage and TODO/FIXME markers in `seki-web/frontend/src/components/user-label.tsx`, `seki-web/frontend/src/components/chat.tsx`, and `seki-web/frontend/src/layouts/form-variants/shared.tsx`
- [x] T002 [P] Confirm current frontend verification commands from `seki-web/frontend/package.json`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Create the stable `UserLabel` API that all user-story work targets.

**CRITICAL**: No user story work should begin until this phase is complete.

- [x] T003 Redesign `UserLabelProps` around structured user data, explicit context options, and explicit fallback state in `seki-web/frontend/src/components/user-label.tsx`
- [x] T004 Implement presence, stone, rank, profile-link, compact, and emphasis rendering from the new options in `seki-web/frontend/src/components/user-label.tsx`
- [x] T005 Remove the obsolete `isOnline` TODO/FIXME API comments after replacing them with explicit option behavior in `seki-web/frontend/src/components/user-label.tsx`
- [x] T006 [P] Add focused option/fallback tests for `UserLabel` behavior in `seki-web/frontend/src/__tests__/user-label.test.tsx`

**Checkpoint**: `UserLabel` has a stable structured-data API and can render fallback states without fake user data.

---

## Phase 3: User Story 1 - Consistent User Labels (Priority: P1) MVP

**Goal**: Existing structured-user contexts render consistent labels from `UserData`.

**Independent Test**: View player panels, game descriptions, lobby popovers, and user menu labels and confirm display name, rank, stone, presence, and profile-link behavior remain consistent where those indicators are allowed.

### Implementation for User Story 1

- [x] T007 [P] [US1] Update player-panel label usage to pass `UserData` and context options in `seki-web/frontend/src/components/player-panel.tsx`
- [x] T008 [P] [US1] Update game-description black/white label usage to pass `UserData` and context options in `seki-web/frontend/src/components/game-description.tsx`
- [x] T009 [P] [US1] Update lobby popover user label usage to pass `UserData` and context options in `seki-web/frontend/src/components/lobby-popover.tsx`
- [x] T010 [P] [US1] Update current-user menu label usage to pass `UserData` and rating display options in `seki-web/frontend/src/components/user-menu.tsx`
- [x] T011 [US1] Update player panel derivation to keep `UserData` and presence inputs separate from label primitives in `seki-web/frontend/src/game/capabilities/build-panels.ts`
- [x] T012 [US1] Remove old `UserLabel` prop names from all structured-user call sites found by searching `UserLabel` in `seki-web/frontend/src`

**Checkpoint**: User Story 1 works independently with current structured user data and no behavior loss in existing player/game/menu label contexts.

---

## Phase 4: User Story 2 - Context-Specific Label Options (Priority: P2)

**Goal**: Label contexts explicitly include or omit stone, rank, presence, links, and compact affordances according to the frontend spec.

**Independent Test**: Compare player panels, chat sender labels, challenge-user selection, and compact/title-like label contexts against the documented user-label visibility rules.

### Implementation for User Story 2

- [x] T013 [P] [US2] Update chat sender labels to pass stone and presence context options for known black/white players in `seki-web/frontend/src/components/chat.tsx`
- [x] T014 [US2] Replace the chat `FIXME_USER_DATA_FROM_ENTRY` path with explicit sender fallback or real room user data usage in `seki-web/frontend/src/components/chat.tsx`
- [x] T015 [P] [US2] Update challenge selected-opponent label options to show rank and presence while hiding stone in `seki-web/frontend/src/layouts/form-variants/shared.tsx`
- [x] T016 [US2] Update challenge search-result label options to show full user-label presentation minus stone in `seki-web/frontend/src/layouts/form-variants/shared.tsx`
- [x] T017 [US2] Preserve compact or title-like label behavior by keeping non-label title strings out of `UserLabel` call sites in `seki-web/frontend/src/layouts/live-game.tsx`
- [x] T018 [US2] Add or update focused frontend coverage for context option behavior in `seki-web/frontend/src/__tests__/user-label.test.tsx`

**Checkpoint**: User Story 2 works independently with context options visible at call sites and no indicator behavior controlled by deleting user fields.

---

## Phase 5: User Story 3 - Complete User Data Flow (Priority: P3)

**Goal**: First-party user-related screens pass complete `UserData` into `UserLabel` and fix primitive-only data contracts at the source.

**Independent Test**: Search all `UserLabel` call sites and direct username/user-info rendering, then verify real displayed users receive structured user data directly; primitive-only user fields remain only for non-label text, document-title-like strings, or explicit fallback states.

### Implementation for User Story 3

- [x] T019 [US3] Update the user-search response shape to expose structured user data for each result in `seki-web/src/routes/users.rs`
- [x] T020 [US3] Update `OpponentSearchResult` to carry structured user data and remove the `Need proper UserData` FIXME in `seki-web/frontend/src/layouts/form-variants/shared.tsx`
- [x] T021 [US3] Update selected-opponent state initialization to use structured user data only when the screen has it, with explicit fallback otherwise, in `seki-web/frontend/src/layouts/form-variants/shared.tsx`
- [x] T022 [US3] Update game settings challenge opponent handling to preserve structured opponent data from search results in `seki-web/frontend/src/layouts/game-settings-form.tsx`
- [x] T023 [US3] Update chat message or room data contract to provide structured sender data when needed by labels in `seki-web/src/routes/web_api/games.rs`
- [x] T024 [US3] Update frontend game/chat message types to model structured sender data or explicit fallback in `seki-web/frontend/src/game/types.ts`
- [x] T025 [US3] Update chat data flow to pass structured sender data without fabricating partial users in `seki-web/frontend/src/components/chat.tsx`
- [x] T026 [US3] Search `seki-web/frontend/src` for direct username, `display_name`, `rank`, `isOnline`, and `profileUrl` rendering and strongly consider replacing real-user identity display with `UserLabel`, except document-title-like strings and non-label text
- [x] T027 [US3] Verify game-list, room/game user-list, and profile display paths either use `UserLabel` for real-user identity display or have an explicit non-label/document-title reason in `seki-web/frontend/src`
- [x] T028 [US3] Verify game-context labels use game snapshotted rank data while neutral contexts use current `UserData.rank` in `seki-web/frontend/src/components` and `seki-web/frontend/src/layouts`

**Checkpoint**: User Story 3 works independently after data contracts are aligned and all real-user labels use structured data.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Verify behavior, keep docs aligned, and prevent oversized-file drift.

- [x] T029 [P] Run frontend typecheck from `seki-web/frontend` with `pnpm run typecheck`
- [x] T030 [P] Run frontend tests from `seki-web/frontend` with `pnpm test`
- [x] T031 [P] Run frontend build from `seki-web/frontend` with `pnpm run build`
- [x] T032 Run `cargo test -p seki-web` from repository root if Rust response shapes changed in `seki-web/src/routes/users.rs` or `seki-web/src/routes/web_api/games.rs`
- [x] T033 [P] Update `FRONTEND_SPEC.md` only if implementation changes the documented user-label behavior
- [x] T034 [P] Check `seki-web/frontend/src/layouts/form-variants/shared.tsx` line count and extract a focused helper if the UserData migration adds mixed concerns
- [x] T035 Remove obsolete UserLabel refactor TODO/FIXME comments after implementation in `seki-web/frontend/src/components/user-label.tsx`, `seki-web/frontend/src/components/chat.tsx`, and `seki-web/frontend/src/layouts/form-variants/shared.tsx`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies.
- **Foundational (Phase 2)**: Depends on Setup and blocks all user stories.
- **User Story 1 (Phase 3)**: Depends on Foundational.
- **User Story 2 (Phase 4)**: Depends on Foundational; can run alongside User Story 1 after the new API exists.
- **User Story 3 (Phase 5)**: Depends on Foundational; some tasks may benefit from User Story 2 chat/search context work.
- **Polish (Phase 6)**: Depends on the desired user stories being complete.

### User Story Dependencies

- **User Story 1 (P1)**: MVP after Foundational; no dependency on US2 or US3.
- **User Story 2 (P2)**: Can start after Foundational; integrates with US1 call-site patterns.
- **User Story 3 (P3)**: Can start after Foundational; completes the source-data contract and primitive-cleanup requirement.

### Parallel Opportunities

- T002 can run while T001 reviews call sites.
- T006 can run alongside T003-T005 once the target API shape is known.
- T007-T010 touch different files and can run in parallel after Foundational.
- T013 and T015 touch different files and can run in parallel after Foundational.
- T029-T031 and T033-T034 can run in parallel during polish.

---

## Parallel Example: User Story 1

```bash
Task: "Update player-panel label usage in seki-web/frontend/src/components/player-panel.tsx"
Task: "Update game-description label usage in seki-web/frontend/src/components/game-description.tsx"
Task: "Update lobby popover label usage in seki-web/frontend/src/components/lobby-popover.tsx"
Task: "Update current-user menu label usage in seki-web/frontend/src/components/user-menu.tsx"
```

---

## Parallel Example: User Story 2

```bash
Task: "Update chat sender label options in seki-web/frontend/src/components/chat.tsx"
Task: "Update selected-opponent label options in seki-web/frontend/src/layouts/form-variants/shared.tsx"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup.
2. Complete Phase 2: Foundational `UserLabel` API.
3. Complete Phase 3: User Story 1.
4. Validate with `pnpm run typecheck` and focused manual checks for player/game/menu labels.

### Incremental Delivery

1. Foundation: stabilize `UserLabel` API.
2. US1: migrate existing structured-user call sites.
3. US2: make context-specific visibility explicit in chat/search/compact contexts.
4. US3: fix primitive-only data contracts, replace direct real-user identity rendering where appropriate, and verify context-correct rank sources.
5. Polish: run quickstart verification and update docs only if behavior changed.

### Notes

- [P] tasks use different files or are verification tasks that do not depend on each other.
- [US1], [US2], and [US3] labels map to the prioritized stories in [spec.md](./spec.md).
- Do not add dependencies for this feature.
- Do not fabricate partial `UserData` at call sites; use explicit fallback states instead.
