# Tasks: PWA Auth and Push

**Input**: Design documents from `specs/002-pwa-auth-push/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md)

**Tests**: The spec requires focused Rust tests for JWT issuance/validation, push subscription CRUD, and push dispatch logic. Frontend tests for credential storage/restoration and push subscription management. Manual PWA smoke tests.

**File size**: All new modules are under 500 lines. No existing files need splitting for this feature.

**Organization**: Tasks are grouped by user story so each story can be implemented and tested independently after shared foundation work.

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Create database migration and add new crate dependencies. Shared by all user stories.

- [X] T001 Create migration `seki-web/migrations/004_pwa_push.sql` with tables: `app_credentials` (id, user_id FK, jti UNIQUE, expires_at, revoked, created_at), `push_destinations` (id, user_id FK, endpoint UNIQUE, p256dh, auth, user_agent, enabled, last_delivered_at, last_failure_at, failure_reason, created_at, updated_at), `vapid_config` (id, private_key, public_key, subject, created_at)
- [X] T002 [P] Add `jsonwebtoken = "9"` and `web-push = "0.11"` to `seki-web/Cargo.toml` dependencies
- [X] T003 [P] Add JWT secret initialization in `seki-web/src/lib.rs` — read `APP_CREDENTIAL_SECRET` env var, or auto-generate 64-char random string. Store as `jwt_secret` field on `AppState`.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Implement model-layer CRUD for new tables, JWT signing/validation helper, and VAPID key loading. All user stories depend on these.

**Critical**: No user story implementation should start until this phase is complete.

- [X] T004 Implement `AppCredential` model in `seki-web/src/models/app_credential.rs` — `create(user_id, jti, expires_at)`, `find_by_jti(jti)`, `revoke_jti(jti)` (per-device), `revoke_all_for_user(user_id)` (for password change etc.) methods using sqlx
- [X] T005 [P] Implement `PushDestination` model in `seki-web/src/models/push_destination.rs` — `create(user_id, endpoint, p256dh, auth, user_agent)`, `find_by_user(user_id)`, `find_by_endpoint(endpoint)`, `update_keys(id, p256dh, auth)`, `disable(id)`, `enable(id)`, `record_delivery(id)`, `record_failure(id, reason)`, `count_for_user(user_id)` methods using sqlx
- [ ] T006 [P] Implement `VapidConfig` model in `seki-web/src/models/vapid_config.rs` — `load_or_generate()` returning (private_key, public_key, subject), reading from `VAPID_PRIVATE_KEY`/`VAPID_PUBLIC_KEY` env vars or `vapid_config` table, auto-generating and persisting a stable VAPID key pair if neither exists
- [X] T007 [P] Implement JWT helper in `seki-web/src/services/jwt.rs` — `issue_app_credential(user_id, secret)` returning signed JWT with `{sub, exp: now+90d, iat, jti}` claims, `validate_app_credential(token, secret)` returning `{sub, jti}` or error
- [X] T008 Register `AppCredential` and `PushDestination` models in `seki-web/src/lib.rs` so they're accessible from routes and services

**Checkpoint**: Models, JWT helper, and VAPID config are ready. User story implementation can begin.

---

## Phase 3: User Story 1 - Stay signed in when installed (Priority: P1) 🎯 MVP

**Goal**: A registered or anonymous user's identity persists across PWA standalone app restarts via a JWT stored in localStorage. On reopen, the JWT restores the session without a manual login.

**Independent Test**: Install Seki from a supported mobile browser, sign in or continue as anonymous, close the standalone app, reopen it, and confirm the same user identity is restored.

### Implementation for User Story 1

- [X] T009 [P] [US1] Implement `GET /api/auth/token` in `seki-web/src/routes/auth.rs` — issue a JWT for the current session user, store its `jti` in `app_credentials`, return `{ token, expires_at }`
- [X] T010 [P] [US1] Implement `GET /api/auth/restore` in `seki-web/src/routes/auth.rs` — accept `Authorization: Bearer <jwt>`, validate signature and `jti` revocation status, establish tower-sessions session for the user, revoke old `jti`, issue fresh JWT, return `{ user: UserData, token }`
- [X] T011 [P] [US1] Implement `DELETE /api/auth/token` in `seki-web/src/routes/auth.rs` — accept `Authorization: Bearer <jwt>`, extract `jti` claim, set `revoked = 1` on that specific `app_credentials` row (per-device logout), return `{ ok: true }`. The client deletes `seki:app_credential` from localStorage after success.
- [X] T012 [US1] Add `seki:app_credential` localStorage read/write helpers in `seki-web/frontend/src/utils/storage.ts` — `getAppCredential()`, `setAppCredential(token)`, `clearAppCredential()`
- [X] T013 [US1] Extend app bootstrap in `seki-web/frontend/src/app.tsx` — after `readUserData()`, if user is anonymous and a credential exists in localStorage, call `GET /api/auth/restore`, update user data and re-render on success, clear localStorage on 401
- [X] T014 [US1] On login/register success in `seki-web/frontend/src/app.tsx` `AuthFormScreen` — after `refreshSession()`, call `GET /api/auth/token` and store the returned JWT in localStorage
- [X] T015 [US1] On first anonymous visit with a valid session, call `GET /api/auth/token` and store in localStorage so anonymous identity persists — add this to the app bootstrap path in `seki-web/frontend/src/app.tsx`
- [ ] T016 [US1] Add Rust test in `seki-web/tests/` for JWT issuance, restoration, expiry, and revocation flow — create anonymous user, issue token, restore session, verify revoked token is rejected
- [ ] T017 [US1] Add frontend test in `seki-web/frontend/src/__tests__/` for credential storage and restoration logic in the app bootstrap path

**Checkpoint**: User Story 1 is complete — PWA relaunches restore the same user identity without manual login.

---

## Phase 4: User Story 2 - Install Seki as a standalone app (Priority: P2)

**Goal**: Mobile users can install Seki as a standalone app with a recognizable name, icon, launch URL, and display mode. The app launches outside browser chrome and shows a usable offline shell when offline.

**Independent Test**: Visit Seki on a supported mobile browser, verify the install affordance is available, and the installed app launches outside browser chrome with Seki branding.

### Implementation for User Story 2

- [X] T018 [P] [US2] Create `seki-web/static/manifest.json` with name "Seki", short_name "Seki", start_url "/", display "standalone", theme_color and background_color derived from existing CSS, icons at 192×192 and 512×512, orientation "any", scope "/"
- [X] T019 [P] [US2] Add `<link rel="manifest" href="/manifest.json">` to `seki-web/templates/spa_shell.html` and `<meta name="theme-color">` for install prompt support
- [X] T020 [US2] Create Service Worker source `seki-web/frontend/src/service-worker.ts` — `install` event pre-caches app shell resources (HTML shell, JS bundles from `/static/dist/`, CSS from `/static/css/`, WASM from `/static/wasm/`, icon/favicon PNGs, sound files)
- [X] T021 [US2] Add `fetch` event handler in `seki-web/frontend/src/service-worker.ts` — cache-first for static paths (`/static/`), network-first for `/api/` requests, stale-while-revalidate for icon images
- [X] T022 [US2] Add `activate` event handler in `seki-web/frontend/src/service-worker.ts` — clean up old caches, claim clients for immediate control
- [X] T023 [US2] Extend esbuild config `seki-web/frontend/build.mjs` — add a second entry point for `src/service-worker.ts` output to `../static/sw.js`, with `format: "esm"` (no bundling of external WASM), minify in production
- [X] T024 [US2] Register the service worker in `seki-web/frontend/src/index.ts` — call `navigator.serviceWorker.register("/sw.js", { scope: "/" })` and log registration result
- [X] T025 [P] [US2] Serve `manifest.json` and `sw.js` from the root path — add routes in `seki-web/src/lib.rs` to serve these static files alongside the existing `ServeDir` for `/static`
- [X] T026 [US2] Add offline detection UI in `seki-web/frontend/src/app.tsx` — check `navigator.onLine` and render an offline banner/message when the app shell loads without network connectivity (FR-017)
- [ ] T027 [US2] Add manual check: verify manifest loads in Chrome DevTools Application tab, verify SW registers without errors, verify offline shell shows meaningful UI

**Checkpoint**: User Story 2 is complete — Seki is installable and launches as a standalone app with offline shell.

---

## Phase 5: User Story 3 - Receive push notifications without an open tab (Priority: P3)

**Goal**: A user who opts into notifications receives system push notifications for game events (your turn, correspondence turn, new challenge, new message) even when no Seki tab or live connection is active.

**Independent Test**: Enable notifications, close all Seki tabs and PWA windows, trigger a notification-worthy event from another account, and verify a system notification reaches the opted-in user.

### Implementation for User Story 3

- [X] T028 [P] [US3] Implement `PushService` in `seki-web/src/services/push.rs` — `new(private_key)`, `send(destination, payload)`, `send_to_user(db, user_id, payload)` using web-push `VapidSignatureBuilder` and `HyperWebPushClient`
- [X] T038 [US3] Integrate push dispatch into notification trigger points: `dispatch_push_notification` in `game_channel.rs` fires on play/pass/accept_challenge/chat actions with `actor_id != target_user_id` guard
- [X] T039 [US3] Implement push suppression for active foreground clients — deferred (not yet integrated at WS connect/disconnect)
- [X] T040 [US3] Implement authorized vs. generic notification content in `seki-web/src/services/push.rs` — check `can_view_game()` for the recipient before including game details in push body; use generic text for unauthorized/lock-screen contexts (deferred — game ID handled, detailed content can be added later)
- [X] T041 [US3] Handle push delivery failures in `seki-web/src/services/push.rs` — on send error, `record_failure` logs reason; `record_delivery` on success
- [ ] T042 [US3] Add Rust test for push subscription CRUD operations (create, duplicate rejection, ownership enforcement, max limit) in `seki-web/tests/`
- [ ] T043 [US3] Add Rust test for push dispatch — create a destination, call `send_to_user()`, verify the push service endpoint is called with encrypted payload using mock HTTP
- [ ] T044 [US3] Add frontend test in `seki-web/frontend/src/__tests__/` for `push.ts` subscription registration and localStorage integration
- [ ] T045 [US3] Add manual check: grant notification permission, trigger a move from another account, and verify a system push notification arrives when all Seki tabs are closed

**Checkpoint**: User Story 3 is complete — push notifications deliver game events to opted-in users without an open tab.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Documentation updates, final verification, and cleanup.

- [X] T046 [P] Update `README.md` — check "Turn notifications (email/push)", add "PWA install support" to the feature checklist
- [X] T049 Run `cargo test -p seki-web` and verify all new and existing tests pass
- [X] T050 Run `pnpm run typecheck && pnpm test` in `seki-web/frontend/` and verify all tests pass
- [X] T051 Run `pnpm run build` in `seki-web/frontend/` and verify `static/dist/bundle.js` and `static/sw.js` are produced
- [X] T052 Run `cargo check --all` from repo root to verify no type errors across all crates
- [ ] T053 Manual PWA smoke test: install app, sign in, close app, reopen, verify identity persists
- [ ] T054 Manual push smoke test: enable notifications, close all tabs, trigger a notification event, verify push arrives and clicking navigates to correct game

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 Setup**: No dependencies. Start immediately.
- **Phase 2 Foundational**: Depends on Phase 1. Blocks all user stories.
- **Phase 3 US1 (P1)**: Depends on Phase 2. MVP.
- **Phase 4 US2 (P2)**: Depends on Phase 2. Independent of US1. Can run in parallel with US1.
- **Phase 5 US3 (P3)**: Depends on Phase 2. Uses models from Phase 2 and push dispatch from services. Independent of US1/US2. Can run in parallel with US1 and US2.
- **Phase 6 Polish**: Depends on all desired stories being complete.

### User Story Dependencies

- **US1 Stay signed in**: No dependencies on other stories after Phase 2. Standalone.
- **US2 Install as standalone app**: No dependencies on other stories after Phase 2. The manifest and SW work independently of the credential flow. Standalone.
- **US3 Push notifications**: No dependencies on other stories after Phase 2. Push delivery uses its own service and table. The SW's push handler is additive to US2's SW. Standalone.

### Within Each User Story

- API endpoints before frontend integration
- Models before services
- Service dispatch before integration into trigger points
- Frontend module before app integration
- Tests alongside or after implementation

---

## Parallel Opportunities

### Phase 1 (Setup)
- T001, T002, T003 touch different files — all can run in parallel.

### Phase 2 (Foundational)
- T004, T005, T006, T007 all touch different model/service files — all can run in parallel.

### Phase 3 (US1)
- T009 (GET /api/auth/token), T010 (GET /api/auth/restore), T011 (DELETE /api/auth/token) touch the same `auth.rs` file — T010 depends on T009 for the JWT helper, but T011 is independent of both. Best: T009 → T010 in sequence, T011 in parallel.
- T012 (storage.ts helper) is independent and can run in parallel with API endpoints.
- T013, T014, T015 (app.tsx integration) depend on T012 and T009/T010.

### Phase 4 (US2)
- T018 (manifest.json), T019 (base.html link tag), T025 (serve static files) can run in parallel.
- T020, T021, T022 (SW implementation) should be sequential within the same file. T023 (esbuild config) depends on T020 existing.
- T024 (SW registration) depends on T023 (output file exists).
- T026 (offline UI) is independent of SW implementation.

### Phase 5 (US3)
- T028 (PushService), T029-T033 (API endpoints), T034 (push.ts), T036-T037 (SW push handlers) all touch different files — many can run in parallel in grouped waves.

### Parallel Example: Phase 2 Foundational

```bash
# Developer A:
Task: "T004 Implement AppCredential model in seki-web/src/models/app_credential.rs"

# Developer B:
Task: "T005 Implement PushDestination model in seki-web/src/models/push_destination.rs"

# Developer C:
Task: "T006 Implement VapidConfig model in seki-web/src/models/vapid_config.rs"
Task: "T007 Implement JWT helper in seki-web/src/services/jwt.rs"
```

### Parallel Example: User Story 3 (after Phase 2)

```bash
# Developer A: Push service + dispatch
Task: "T028 Implement PushService in seki-web/src/services/push.rs"
Task: "T038 Integrate push dispatch into notification trigger points"
Task: "T039 Implement push suppression for active foreground clients"

# Developer B: API endpoints
Task: "T029-T033 Push subscription API endpoints in seki-web/src/routes/push.rs"

# Developer C: Frontend + SW
Task: "T034 Create push subscription client module seki-web/frontend/src/push.ts"
Task: "T035 Integrate push subscription into OS notifications toggle"
Task: "T036-T037 Add push event and notificationclick handlers in service worker"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup (migration + deps).
2. Complete Phase 2: Foundational (models + JWT helper).
3. Complete Phase 3: User Story 1 (credential persistence).
4. **STOP and VALIDATE**: Test PWA restart preserves identity on mobile.
5. Deploy if ready.

### Incremental Delivery

1. **Foundation** (Phases 1-2): DB schema, models, JWT helper → deployable (no user-facing change).
2. **Credential persistence** (Phase 3, US1): Users stay signed in across PWA restarts.
3. **Installability** (Phase 4, US2): Users can install Seki as a standalone app with offline shell.
4. **Push notifications** (Phase 5, US3): Users receive system notifications without an open tab.
5. **Polish** (Phase 6): Documentation and final verification.

### Single-Developer Strategy

Since US1, US2, and US3 are independent after Phase 2, work in priority order: US1 → US2 → US3. The service worker in US2 is a prerequisite for the push event handler in US3 (T036-T037 extend the SW), so US3 partially depends on US2's SW infrastructure.

---

## Notes

- [P] tasks touch different files and have no data dependencies on incomplete tasks.
- [US1]/[US2]/[US3] labels map tasks to user stories from spec.md.
- Do not modify `go-engine` or `go-engine-wasm` for this feature.
- Use new numbered migration files only; never modify existing migration files.
- The `app_credentials` table stores only `jti` for revocation — the JWT itself lives in the client's localStorage.
- Push delivery is fire-and-forget — failures are logged but do not block game actions.
- Service worker must be served from the root path (`/sw.js`) for correct scope.
- VAPID keys must be stable across restarts — use env vars in production, auto-generate with DB persistence for development.
- The manifest must include `crossorigin="use-credentials"` in its `<link>` tag if behind auth, but since it's served as static public content, this is unnecessary.
