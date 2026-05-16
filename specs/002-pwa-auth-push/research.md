# Research: PWA Auth and Push

**Date**: 2026-05-16

## 1. Browser App Credential Design

### Decision
Use JWT tokens stored in `localStorage`, sent as `Authorization: Bearer <token>` headers for initial session restoration. After restoration, the tower-sessions session cookie handles subsequent requests for the duration of the browsing session.

### Why not cookies
In testing, cookies — even persistent cookies with explicit `Max-Age` — do NOT survive PWA standalone webview restarts or refreshes on the target mobile platforms. The standalone webview sandbox appears to discard all cookie state. `localStorage`, however, reliably persists across PWA restarts.

### JWT token structure
```json
{
  "sub": "<user_id>",
  "exp": "<now + 90 days>",
  "iat": "<issue timestamp>",
  "jti": "<opaque uuid — for DB-backed revocation>"
}
```
Signed with HMAC-SHA256 using a server-side secret (env var `APP_CREDENTIAL_SECRET` or auto-generated on first startup and stored in DB).

### Flow
1. **Issuance**: On login, register, or first anonymous visit, the server issues a JWT and returns it in the bootstrap JSON. The frontend stores it in `localStorage` under `seki:app_credential`.
2. **Restoration**: On page load (PWA restart), if no valid session exists (user rendered as anonymous), the frontend reads the JWT from `localStorage` and calls `GET /api/auth/restore` with `Authorization: Bearer <jwt>`. The server validates the JWT, establishes a tower-sessions session, and returns the user data. The frontend re-renders with the correct identity.
3. **Renewal**: Each successful restoration also returns a fresh JWT (new `exp` and `jti`), which the frontend stores in `localStorage`, replacing the old one. This provides the rolling 90-day expiry.
4. **Revocation**: On logout or password change, the server increments a `token_version` column on the `users` table. The JWT includes `jti` which is tracked in the `app_credentials` table — a token is only valid if its `jti` matches the latest issued `jti` for that user. On logout, all credentials for the user are marked revoked.

### Rationale
- `localStorage` persists across PWA standalone webview restarts where cookies do not.
- JWT is self-validating (no DB lookup for signature verification), with a fast DB check for revocation only.
- The credential is only checked on initial session restoration, not every request. Once the session is established, tower-sessions handles the rest.
- Anonymous users get the same credential — their JWT proves their anonymous identity across restarts.
- Registration upgrade preserves the `user_id`, so the same JWT works before and after registration (though a new JWT is issued on registration to ensure consistency).

### Alternatives considered
1. **HTTP-only persistent cookies**: Rejected — empirical testing shows cookies do not survive PWA standalone webview restarts on target mobile platforms.
2. **Opaque tokens in localStorage**: Rejected in favor of JWT — JWT avoids a DB lookup on every restoration for signature verification. The revocation check is a fast indexed lookup.
3. **Opaque token cookie + Service Worker injection**: Rejected — the SW injection approach adds significant complexity and a bootstrapping problem (the SW must be active before the first page load for it to inject headers).
4. **Extending existing session_token**: Rejected — session_token semantics are tied to tower-sessions; a separate credential has a different lifecycle.

---

## 2. Web Push Implementation

### Decision
Use the `web-push` Rust crate for server-side push delivery. The flow:
1. Server generates VAPID keypair on startup (or from env vars).
2. Client registers a ServiceWorker, requests push subscription via `PushManager.subscribe()`.
3. Client sends the subscription object (endpoint + keys) to `POST /api/push-subscription`.
4. Server stores the subscription in `push_destinations` table linked to the user and their session/device.
5. On notification events, the server checks user preferences, builds a Web Push message, encrypts it with the subscription keys, and sends to the push service endpoint.
6. Service worker receives the push event and shows a system notification.

### Rationale
- `web-push` crate (https://crates.io/crates/web-push) is the de-facto Rust implementation with ~5 transitive dependencies. Fits constitution requirement for minimal dependency trees.
- VAPID (Voluntary Application Server Identification) is required by Chrome for push delivery. Keys can be generated once and stored as env vars or in the DB.
- Per-destination suppression: when a user has an active foreground WS connection, skip push for that destination but deliver to other destinations. This requires tracking "active destination" — the WS connection already has user_id; we add the push subscription ID to the WS handshake to suppress that specific destination.

### Alternatives considered
1. **Firebase Cloud Messaging (FCM)**: Rejected — adds Google dependency, requires Firebase project setup, overkill for a small app.
2. **OneSignal / third-party push service**: Rejected — adds external dependency, privacy concerns, cost.
3. **Custom WebSocket-based push**: Rejected — requires persistent connection, defeats the purpose of push notifications for offline users.
4. **Server-sent events**: Rejected — same persistent connection requirement.

---

## 3. Service Worker Strategy

### Decision
A single service worker at root scope (`/sw.js`) built from TypeScript (`frontend/src/service-worker.ts`) by esbuild as a separate entry point. The SW handles:
1. **Push events**: Receives push messages, parses notification payload, shows `self.registration.showNotification()`.
2. **Notification click**: Listens for `notificationclick`, focuses/closes existing windows or opens a new one, and navigates to the relevant game/page.
3. **Offline shell**: Cache-first strategy for app shell resources (HTML, JS, CSS, WASM, images/sounds). Network-first for API data.

### Rationale
- Single SW is simpler than multiple workers. Scope `/` covers all pages.
- esbuild can compile TS to a standalone JS file for service workers (no DOM APIs, minimal dependencies). The SW entry point uses only `self` (ServiceWorkerGlobalScope) APIs.
- Cache-first for static assets means the app loads meaningfully offline (SC-003 requirement). Network-first for data ensures fresh game state when online.
- The SW file must be served from the root path (service worker scope constraint). We can either copy it to `static/sw.js` via the build script or serve it from a route handler.

### Alternatives considered
1. **Workbox / workbox-precaching**: Rejected — adds significant dependency for functionality we can implement in ~100 lines.
2. **No offline caching**: Rejected — spec requires offline-capable app shell (FR-017).

---

## 4. Notification Event Dispatch

### Decision
Extend the existing notification trigger points (in `services/live.rs`, `services/game_actions.rs`, `services/messages.rs`) with push dispatch hooks. When a notification-worthy event occurs:
1. Check if the target user has push destinations with enabled notifications for this event type.
2. Check if any active WS connection exists for this user (and which push destination IDs are active).
3. For each eligible destination without an active foreground connection, dispatch a push notification.
4. Build push payload with detailed content for authorized recipients, generic content for unauthorized.

### Rationale
- Push dispatch is a parallel path to existing WS broadcast — they're not mutually exclusive. Both can fire for the same event (WS for active tabs, push for inactive devices).
- The suppression rule (FR-014a) requires tracking which push destination is "active" via an active WS connection. The WS handshake can include the push subscription ID if available.
- Preference checks (which event types are enabled) already exist as JSON keys in `users.preferences` — the push service just reads them before dispatching.

### Alternatives considered
1. **Queue-based async dispatch**: Rejected for simplicity — push delivery is fire-and-forget with error logging. A failed push delivery does not block the game action.
2. **Separate notification worker process**: Rejected — overkill for current scale.

---

## 5. Web App Manifest

### Decision
A static `manifest.json` file served from the root path. Contents:
- `name`: "Seki"
- `short_name`: "Seki"
- `start_url`: "/"
- `display`: "standalone"
- `theme_color`, `background_color`: derived from existing CSS variables
- `icons`: list of PNG icons at standard sizes (192x192, 512x512)
- `orientation`: "any"
- `scope`: "/"

### Rationale
- Standard web manifest spec supported by Chrome and Firefox.
- Existing icon assets in `static/images/` provide the necessary sizes.
- Serving from root is the standard location browsers check for manifest discovery.

---

## 6. Database Schema Additions

### Decision
Two new tables (reduced from three — JWT is self-contained, no token storage needed in DB):

**`app_credentials`**: Tracks issued JWT identifiers for revocation.
- `id` (INTEGER PRIMARY KEY)
- `user_id` (INTEGER NOT NULL REFERENCES users(id))
- `jti` (TEXT NOT NULL UNIQUE) — JWT ID, stored by the server after issuance, used to verify the credential hasn't been revoked
- `expires_at` (TEXT NOT NULL) — when this credential naturally expires (matches JWT `exp`)
- `revoked` (INTEGER NOT NULL DEFAULT 0) — set to 1 on logout
- `created_at`, `updated_at`

**`push_destinations`**: Stores push subscription records (unchanged from previous design).
- `id` (INTEGER PRIMARY KEY)
- `user_id` (INTEGER NOT NULL REFERENCES users(id))
- `endpoint` (TEXT NOT NULL) — push service endpoint URL
- `p256dh` (TEXT NOT NULL) — client public key
- `auth` (TEXT NOT NULL) — client auth secret
- `user_agent` (TEXT) — browser/device identification
- `enabled` (INTEGER NOT NULL DEFAULT 1)
- `last_delivered_at`, `last_failure_at`, `failure_reason` (TEXT)
- `created_at`, `updated_at`

### Rationale
- `app_credentials` stores only `jti` (not the token itself) — the JWT lives in the client's localStorage. The DB row exists only for revocation.
- On restoration, the server checks: (1) JWT signature valid, (2) `exp` not past, (3) `jti` row exists and `revoked = 0`.
- On re-issuance, the server revokes the old `jti` and inserts a new row with a fresh `jti` and `expires_at`.
- `push_destinations` unchanged.

---

## 7. Credential Validation and Restoration Flow

### Decision
A new `GET /api/auth/restore` endpoint validates the browser app JWT and establishes a session:

1. Client sends `Authorization: Bearer <jwt>` header (read from `localStorage`).
2. Server validates JWT signature using the HMAC secret.
3. Server checks `exp` claim — reject if expired.
4. Server looks up `app_credentials` row by `jti` — reject if revoked or doesn't match latest for user.
5. Server looks up `user_id` from `sub` claim — reject if user doesn't exist.
6. Server writes the user's `session_token` into the tower-sessions session.
7. Server issues a new JWT with fresh `exp` and `jti`, stores the new `jti` in `app_credentials`, and revokes the old one.
8. Returns `{ user: UserData, token: "<new jwt>" }`.

The frontend stores the new JWT in `localStorage` and updates `window.__sekiUserData`.

### Frontend boot sequence

On `mountApp()`:
1. `readUserData()` from DOM — if user is registered, skip restoration (session is valid).
2. If user is anonymous (no valid session cookie), check `localStorage` for `seki:app_credential`.
3. If credential exists → call `GET /api/auth/restore` with Bearer token. If successful, update user data and re-render. If 401 (expired/revoked), clear `localStorage`.
4. If no credential or restoration failed → proceed as normal anonymous user.

This adds a single async call at app startup when the session cookie is missing.

### Rationale
- Validation only happens on initial session restoration, not every request.
- JWT signature check is ~1ms (HMAC-SHA256), no DB access needed for that step.
- `jti` + `app_credentials` table provides individual token revocation without changing the signing key.
- No changes to the `CurrentUser` extractor — session restoration is a dedicated endpoint.

### Alternatives considered
1. **Modify CurrentUser extractor**: Rejected — would add JWT parsing to every request. A dedicated restore endpoint is cleaner and only called once per browsing session.
2. **No DB table, just JWT**: Rejected — without a revocation mechanism, a stolen JWT is valid until expiry. The `jti` table allows immediate revocation on logout or password change.

---

## 8. Anonymous Push Notifications

### Decision
Anonymous users can register for push notifications. Push delivery eligibility for anonymous users is determined by:
- Browser-local opt-in state (`localStorage` "seki:notifications" === "on")
- Notification permission granted
- `push_destinations.enabled = 1`

The server does NOT check `users.preferences` notification keys for anonymous users because those preferences are browser-local. For registered users, the account-level `notify_*_app` preferences are checked.

### Rationale
- FR-011a explicitly requires anonymous push support with browser-local opt-in.
- Anonymous user identities are server-owned (via `user_id`), so they can have persistent push subscriptions even without a password.
- When an anonymous user registers, their `user_id` stays the same, so push subscriptions carry over naturally.

---

## 9. Push Notification Content

### Decision
Push payload includes JSON with: `title`, `body`, `data` (object with `gameId`, `type`, `userId`). The service worker uses this to construct `showNotification()` with `data` for click handling.

For authorized recipients: include specific game info (opponent name, game ID) in body text.
For unauthorized/lock-screen: use generic text ("New activity in Seki").

Authorization check: verify the recipient can view the game before including details.

### Rationale
- FR-015 requires detailed content for authorized recipients and protected content for unauthorized.
- The `data` field in the notification is not shown to the user but is used for click navigation.

---

## 10. Offline Shell Strategy

### Decision
Cache-first for the app shell: HTML document, JS bundles, CSS, WASM binary, icons/favicons, sound files. Network-first for all `/api/*` requests. The service worker installs on first visit and precaches core assets.

The offline page is the same SPA shell — the frontend detects the network error and renders an offline state UI instead of a broken page.

### Rationale
- FR-017 requires offline-capable shell. The SPA architecture already loads everything client-side, so caching the shell makes it work offline with minimal changes.
- No offline gameplay required — simplifies caching significantly.
- The SW update flow: new version detected → "Update available" prompt or auto-update in background.

---

## 11. VAPID Key Management

### Decision
VAPID keys generated on first startup and stored in a `vapid_config` table (or environment variables). If env vars `VAPID_PRIVATE_KEY` and `VAPID_PUBLIC_KEY` are set, use those. Otherwise, generate and persist.

### Rationale
- VAPID keys must be stable — if they change, all existing push subscriptions become invalid.
- Environment variables are the standard approach for production deployments.
- Automatic generation + DB storage provides a zero-config development experience.

### Alternatives considered
1. **Hardcoded keys**: Rejected — security risk.
2. **Auto-generated every startup**: Rejected — invalidates all push subscriptions on restart.
