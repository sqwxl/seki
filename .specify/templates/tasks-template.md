---

description: "Task list template for feature implementation"
---

# Tasks: [FEATURE NAME]

**Input**: Design documents from `/specs/[###-feature-name]/`

**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/

**Tests**: Include the smallest useful verification tasks required by the
constitution. Use focused Rust tests for engine/service/API changes, Vitest or
typecheck tasks for frontend state and utilities, and documented manual checks
only when automated coverage is not practical.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Path Conventions

- **Engine**: `go-engine/src/` for pure game logic, SGF, game tree, replay, and scoring
- **WASM boundary**: `go-engine-wasm/src/` for wasm-bindgen conversion only
- **Web backend**: `seki-web/src/models/`, `services/`, `routes/`, `ws/`, `templates/`
- **Frontend**: `seki-web/frontend/src/game/`, `goban/`, `components/`,
  `layouts/`, `utils/`, `__tests__/`
- **Database**: SQLite migrations in `seki-web/migrations/`; add new numbered files only
- **Docs**: `README.md`, `FRONTEND_SPEC.md`, `API_SPEC.md`

<!--
  ============================================================================
  IMPORTANT: The tasks below are SAMPLE TASKS for illustration purposes only.

  The /speckit-tasks command MUST replace these with actual tasks based on:
  - User stories from spec.md (with their priorities P1, P2, P3...)
  - Feature requirements from plan.md
  - Entities from data-model.md
  - Endpoints from contracts/

  Tasks MUST be organized by user story so each story can be:
  - Implemented independently
  - Tested independently
  - Delivered as an MVP increment

  DO NOT keep these sample tasks in the generated tasks.md file.
  ============================================================================
-->

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and basic structure

- [ ] T001 Create project structure per implementation plan
- [ ] T002 Initialize [language] project with [framework] dependencies
- [ ] T003 [P] Configure linting and formatting tools

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

Examples of foundational tasks (adjust based on your project):

- [ ] T004 Setup database schema and migrations framework
- [ ] T005 [P] Implement authentication/authorization framework
- [ ] T006 [P] Setup API routing and middleware structure
- [ ] T007 Create base models/entities that all stories depend on
- [ ] T008 Configure error handling and logging infrastructure
- [ ] T009 Setup environment configuration management

**Checkpoint**: Foundation ready - user story implementation can now begin in parallel

---

## Phase 3: User Story 1 - [Title] (Priority: P1) 🎯 MVP

**Goal**: [Brief description of what this story delivers]

**Independent Test**: [How to verify this story works on its own]

### Tests for User Story 1

- [ ] T010 [P] [US1] Add focused test for [engine/service/API/frontend behavior] in [path]
- [ ] T011 [P] [US1] Add contract or integration coverage for [user journey] in [path]

### Implementation for User Story 1

- [ ] T012 [P] [US1] Update [model/entity/helper] in [repo path]
- [ ] T013 [P] [US1] Update [frontend/component/helper] in [repo path]
- [ ] T014 [US1] Implement [service or engine behavior] in [repo path] (depends on T012, T013)
- [ ] T015 [US1] Implement [route/websocket/frontend feature] in [repo path]
- [ ] T016 [US1] Add validation and error handling
- [ ] T017 [US1] Add logging for user story 1 operations

**Checkpoint**: At this point, User Story 1 should be fully functional and testable independently

---

## Phase 4: User Story 2 - [Title] (Priority: P2)

**Goal**: [Brief description of what this story delivers]

**Independent Test**: [How to verify this story works on its own]

### Tests for User Story 2

- [ ] T018 [P] [US2] Add focused test for [engine/service/API/frontend behavior] in [path]
- [ ] T019 [P] [US2] Add contract or integration coverage for [user journey] in [path]

### Implementation for User Story 2

- [ ] T020 [P] [US2] Update [model/entity/helper] in [repo path]
- [ ] T021 [US2] Implement [service or engine behavior] in [repo path]
- [ ] T022 [US2] Implement [route/websocket/frontend feature] in [repo path]
- [ ] T023 [US2] Integrate with User Story 1 components (if needed)

**Checkpoint**: At this point, User Stories 1 AND 2 should both work independently

---

## Phase 5: User Story 3 - [Title] (Priority: P3)

**Goal**: [Brief description of what this story delivers]

**Independent Test**: [How to verify this story works on its own]

### Tests for User Story 3

- [ ] T024 [P] [US3] Add focused test for [engine/service/API/frontend behavior] in [path]
- [ ] T025 [P] [US3] Add contract or integration coverage for [user journey] in [path]

### Implementation for User Story 3

- [ ] T026 [P] [US3] Update [model/entity/helper] in [repo path]
- [ ] T027 [US3] Implement [service or engine behavior] in [repo path]
- [ ] T028 [US3] Implement [route/websocket/frontend feature] in [repo path]

**Checkpoint**: All user stories should now be independently functional

---

[Add more user story phases as needed, following the same pattern]

---

## Phase N: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect multiple user stories

- [ ] TXXX [P] Update `README.md`, `FRONTEND_SPEC.md`, or `API_SPEC.md` if behavior changed
- [ ] TXXX Code cleanup and refactoring
- [ ] TXXX Performance optimization across all stories
- [ ] TXXX [P] Additional focused tests in the relevant crate or frontend test directory
- [ ] TXXX Security hardening
- [ ] TXXX Run quickstart.md validation

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion - BLOCKS all user stories
- **User Stories (Phase 3+)**: All depend on Foundational phase completion
  - User stories can then proceed in parallel (if staffed)
  - Or sequentially in priority order (P1 → P2 → P3)
- **Polish (Final Phase)**: Depends on all desired user stories being complete

### User Story Dependencies

- **User Story 1 (P1)**: Can start after Foundational (Phase 2) - No dependencies on other stories
- **User Story 2 (P2)**: Can start after Foundational (Phase 2) - May integrate with US1 but should be independently testable
- **User Story 3 (P3)**: Can start after Foundational (Phase 2) - May integrate with US1/US2 but should be independently testable

### Within Each User Story

- Tests and verification tasks SHOULD be created before or alongside the code
  they validate
- Models before services
- Services before endpoints
- Core implementation before integration
- Story complete before moving to next priority

### Parallel Opportunities

- All Setup tasks marked [P] can run in parallel
- All Foundational tasks marked [P] can run in parallel (within Phase 2)
- Once Foundational phase completes, all user stories can start in parallel (if team capacity allows)
- All tests for a user story marked [P] can run in parallel
- Models within a story marked [P] can run in parallel
- Different user stories can be worked on in parallel by different team members

---

## Parallel Example: User Story 1

```bash
# Launch all tests for User Story 1 together (if tests requested):
Task: "Focused Rust/API/frontend test for [behavior] in [repo path]"
Task: "Contract or integration coverage for [user journey] in [repo path]"

# Launch all models for User Story 1 together:
Task: "Update [entity/helper] in [repo path]"
Task: "Update [frontend/component/helper] in [repo path]"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (CRITICAL - blocks all stories)
3. Complete Phase 3: User Story 1
4. **STOP and VALIDATE**: Test User Story 1 independently
5. Deploy/demo if ready

### Incremental Delivery

1. Complete Setup + Foundational → Foundation ready
2. Add User Story 1 → Test independently → Deploy/Demo (MVP!)
3. Add User Story 2 → Test independently → Deploy/Demo
4. Add User Story 3 → Test independently → Deploy/Demo
5. Each story adds value without breaking previous stories

### Parallel Team Strategy

With multiple developers:

1. Team completes Setup + Foundational together
2. Once Foundational is done:
   - Developer A: User Story 1
   - Developer B: User Story 2
   - Developer C: User Story 3
3. Stories complete and integrate independently

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- Each user story SHOULD be independently completable and testable
- When adding automated tests before implementation, verify they fail for the expected reason
- Commit logical groups directly to `main` when the user requests commits
- Stop at any checkpoint to validate story independently
- Avoid: vague tasks, same file conflicts, cross-story dependencies that break independence
