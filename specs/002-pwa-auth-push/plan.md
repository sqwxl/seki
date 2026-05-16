# Implementation Plan: PWA Auth and Push

**Branch**: `main` | **Date**: 2026-05-16 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/002-pwa-auth-push/spec.md`

## Summary

Add PWA installability with a web manifest and service worker, add a durable browser app credential as a JWT stored in localStorage (90-day rolling expiry) that survives standalone webview restarts where cookies do not, and implement Web Push notification delivery for all account-level notification events with per-destination opt-in management. The credential is a fallback for session recovery: when the tower-sessions session cookie is lost (as happens in PWA standalone webviews on restart), the JWT from localStorage restores the user's identity via a single API call at boot, after which tower-sessions handles the rest of the browsing session.

## Technical Context

**Language/Version**: Rust (edition 2024), TypeScript 5.x, Node 24

**Primary Dependencies**: axum 0.8, tower-sessions 0.14, tower-sessions-sqlx-store 0.15, sqlx 0.8 (SQLite), Preact 10, esbuild 0.x, wasm-bindgen 0.2. New: `jsonwebtoken` for JWT signing/verification, `web-push` crate for Push API, `hmac`/`sha2` for HMAC-SHA256 (reuse `jsonwebtoken`'s impl).

**Storage**: SQLite via sqlx 0.8. New tables: `app_credentials` (browser/app identity tokens with 90-day rolling expiry), `push_destinations` (per-user/session push subscription records). No changes to existing tables except optionally extending `users` or using a join table.

**Testing**: `cargo test -p seki-web` for Rust service/model/route changes. `pnpm test` (Vitest) for frontend changes. `cargo check --all` for type-checking. Manual testing on supported mobile browsers (Chrome, Firefox) required for PWA install flow.

**Target Platform**: Linux server (Rust/Axum). Client: mobile Chrome, mobile Firefox, desktop Chrome/Firefox for PWA features. Browser APIs: Service Worker, Push API, Notification API, Web App Manifest, BroadcastChannel.

**Project Type**: Web application (full-stack). Frontend SPA + Rust backend + WASM engine.

**Performance Goals**: Push delivery accepted within 30 seconds of triggering event. App credential validation <10ms. Manifest and service worker served as static assets (<50ms). No regressions to existing WS notification latency.

**Constraints**: Service Worker scope limited to `/`. Push subscriptions must use VAPID for application server identification. Browser app credentials are signed JWTs with server-side `jti` revocation tracking. App must function offline with cached shell (no offline gameplay required).

**Scale/Scope**: Current user scale (fits in SQLite). Push destinations: 1-5 per user (multiple devices). New service worker file (~100 lines). New manifest JSON (~30 lines). New DB tables: 2. New Rust modules: 3-4. New frontend modules: 2-3.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **Simplicity and minimal change**: No broad refactors. New `jsonwebtoken` and `web-push` crates (both have small dependency trees). JWT-based app credentials stored in localStorage, validated via a dedicated `/api/auth/restore` endpoint — no changes to existing session/auth flow. `app_credentials` table stores only JWT IDs for revocation. Push destinations stored in a new table. Service worker and manifest are static files served by existing `ServeDir`. No changes to `go-engine` or `go-engine-wasm`.

- **Layer ownership**: 
  - `seki-web/src/models/` — new `app_credential.rs` (JWT jti tracking for revocation), `push_destination.rs` (DB access for push subscriptions)
  - `seki-web/src/services/` — new `push.rs` (push delivery dispatch); JWT signing in a thin auth helper
  - `seki-web/src/routes/` — extend `auth.rs` with `/api/auth/token` (JWT issuance), `/api/auth/restore` (session restoration); new `push.rs` for push subscription API
  - `seki-web/src/ws/` — unchanged except notification dispatch hook for push
  - `seki-web/frontend/src/` — `service-worker.ts`, `push.ts`, extend `app.tsx` for credential restore on mount
  - `go-engine`, `go-engine-wasm` — no changes

- **Server enforcement**: All push subscription registration, replacement, and revocation enforced server-side with same-user validation. Credential tokens validated server-side on every request. Manifest and service worker are public static files; no sensitive logic in them. Push delivery only for authorized recipients.

- **SPA and JSON contracts**: Manifest served at root `/manifest.json` (standard location). Service worker at root `/sw.js` (standard scope). JWT credential issuance at `GET /api/auth/token`, restoration at `GET /api/auth/restore`. Push subscription management via `/api/push-subscription`. No new page templates. No change to SPA shell architecture. The credential token is returned in JSON responses and stored in `localStorage` by the client.

- **File and module size**: New files will be well under 500 lines. `services/push.rs` (~200 lines), `models/app_credential.rs` (~100 lines), `models/push_destination.rs` (~80 lines), `routes/push.rs` (~60 lines). Frontend: `service-worker.ts` (~150 lines), `push.ts` (~80 lines). Existing `services/live.rs` (currently ~220 lines) may grow to ~300 with push dispatch hooks — still under 500.

- **Tests and documentation**: `cargo test -p seki-web` for JWT issuance/validation, push subscription CRUD, push dispatch logic. `pnpm test` for frontend push registration, credential storage/restore, SW lifecycle. `pnpm run typecheck` for TS. Update `README.md` checklist (check "Turn notifications (email/push)", add "PWA install support"). Update `FRONTEND_SPEC.md` and `API_SPEC.md` for push subscription endpoints, JWT credential flow, offline shell behavior.

## Project Structure

### Documentation (this feature)

```text
specs/002-pwa-auth-push/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
└── tasks.md             # Phase 2 output (NOT created by /speckit-plan)
```

### Source Code (repository root)

```text
go-engine/
└── src/                  # No changes

go-engine-wasm/
└── src/                  # No changes

seki-web/
├── migrations/
│   └── 004_pwa_push.sql  # NEW: app_credentials (jti-based), push_destinations, vapid_config tables
├── src/
│   ├── models/
│   │   ├── app_credential.rs      # NEW: JWT jti tracking (revocation)
│   │   ├── push_destination.rs    # NEW: push subscription CRUD
│   │   └── vapid_config.rs        # NEW: VAPID key storage
│   ├── services/
│   │   ├── push.rs                # NEW: push delivery dispatch
│   │   └── jwt.rs                 # NEW: JWT signing/validation helper
│   ├── routes/
│   │   ├── auth.rs                # EXTEND: JWT issuance on login/register, /api/auth/restore endpoint
│   │   └── push.rs                # NEW: push subscription API endpoints
│   └── lib.rs                     # EXTEND: JWT secret init, push init, route registration
├── static/
│   ├── manifest.json              # NEW: web app manifest
│   └── sw.js                      # NEW: service worker (built by esbuild)
└── frontend/src/
    ├── index.ts                   # EXTEND: service worker registration, credential restoration
    ├── app.tsx                    # EXTEND: credential restore on mount, token in localStorage
    ├── push.ts                    # NEW: push subscription management
    └── service-worker.ts          # NEW: service worker source (compiled to sw.js)
```

**Structure Decision**: New modules follow existing directory conventions. `push.rs` is a new service, not an extension of `live.rs`, because push delivery has its own lifecycle (VAPID keys, subscription management, provider communication) distinct from in-process WS broadcasting. The service worker source lives in `frontend/src/` built by esbuild as a separate entry point to `static/sw.js`. The manifest is hand-written static JSON.

## Complexity Tracking

> No constitution violations. All changes are additive, use existing patterns, and stay within established layer boundaries.
