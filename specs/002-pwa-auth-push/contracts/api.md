# API Contracts: PWA Auth and Push

These are the new and modified HTTP API endpoints for browser app credentials and push subscription management.

---

## GET /api/auth/token

Issue a new browser app JWT credential.

**Request**: No body required. Authenticated via existing session cookie (tower-sessions).

**Response 200**:
```json
{
  "token": "eyJhbGciOiJIUzI1NiJ9.eyJz...",
  "expires_at": "2026-08-14T12:00:00Z"
}
```

**Response 401** (not logged in, no session):
```json
{
  "error": { "code": "UNAUTHORIZED", "message": "Authentication required" }
}
```

**Behavior**:
- Creates a new JWT with `{ sub: user_id, exp: now + 90d, iat: now, jti: <random-id> }`, signed with HMAC-SHA256.
- Inserts an `app_credentials` row with the `jti` and `expires_at`.
- Does not revoke other credentials for the same user; multiple installed devices/browser profiles may coexist.
- Returns the JWT and expiry. The client stores the JWT in `localStorage` under `seki:app_credential`.
- Works for both registered and anonymous users.

---

## GET /api/auth/restore

Restore a session using a browser app JWT.

**Request**: `Authorization: Bearer <jwt>` header.

**Response 200**:
```json
{
  "user": { "id": 1, "display_name": "alice", "is_registered": true, ... },
  "token": "eyJhbGciOiJIUzI1NiJ9.eyJz..."  // fresh JWT with new exp + jti
}
```

**Response 401** (invalid/expired/revoked token):
```json
{
  "error": { "code": "UNAUTHORIZED", "message": "Invalid or expired credential" }
}
```

**Behavior**:
1. Validates JWT signature against the server HMAC secret.
2. Checks `exp` is in the future.
3. Looks up `app_credentials` row by `jti` — must exist with `revoked = 0` and `expires_at` in the future.
4. Looks up user by `sub` claim — must exist.
5. Writes the user's `session_token` into the tower-sessions session (establishes session for this browsing session).
6. Revokes the old `jti` row (`revoked = 1`).
7. Issues a new JWT with fresh `exp` and `jti`, inserts a new `app_credentials` row.
8. Returns user data and the new JWT.

---

## DELETE /api/auth/token

Revoke the current device's browser app credential (logout from this device only).

**Request**: `Authorization: Bearer <jwt>` header. The JWT identifies which device credential to revoke.

**Response 200**:
```json
{ "ok": true }
```

**Response 401** (invalid/expired JWT):
```json
{
  "error": { "code": "UNAUTHORIZED", "message": "Invalid or expired credential" }
}
```

**Behavior**:
- Validates the supplied JWT signature and extracts `jti`.
- Sets `revoked = 1` on the matching `app_credentials` row.
- Does NOT affect other credentials for the same user on other devices.
- The client deletes `seki:app_credential` from `localStorage` after success.

---

## GET /api/push-subscription

List push destinations for the current user.

**Response 200**:
```json
{
  "subscriptions": [
    {
      "id": 1,
      "user_agent": "Mozilla/5.0 ...",
      "enabled": true,
      "last_delivered_at": "2026-05-15T10:30:00Z",
      "created_at": "2026-05-01T00:00:00Z"
    }
  ]
}
```

**Notes**: Returns metadata only — never exposes `endpoint`, `p256dh`, or `auth` fields after creation. Users can see their devices but not the raw subscription details.

---

## POST /api/push-subscription

Register or update a push subscription for the current user.

**Request**:
```json
{
  "endpoint": "https://fcm.googleapis.com/fcm/send/...",
  "keys": {
    "p256dh": "BNl4...base64...",
    "auth": "xyz...base64..."
  },
  "user_agent": "Mozilla/5.0 ..."  // optional, auto-detected if missing
}
```

**Response 201**:
```json
{
  "id": 1,
  "user_agent": "Mozilla/5.0 ...",
  "enabled": true,
  "vapid_public_key": "BPb...base64..."  // server's VAPID public key for client
}
```

**Response 400** (invalid subscription):
```json
{
  "error": { "code": "INVALID_SUBSCRIPTION", "message": "Missing required fields: endpoint, keys.p256dh, keys.auth" }
}
```

**Response 413** (too many subscriptions):
```json
{
  "error": { "code": "TOO_MANY_SUBSCRIPTIONS", "message": "Maximum of 10 push destinations per user" }
}
```

**Behavior**:
- Validates endpoint is an HTTPS URL, keys are present and non-empty base64.
- If endpoint already exists for this user → update keys and re-enable.
- If endpoint exists for a DIFFERENT user → reject (push subscription belongs to specific browser profile).
- Stores `user_agent` from request or `User-Agent` header.
- Returns server's VAPID public key so client can verify the application server identity.
- Works for both registered and anonymous users.

---

## DELETE /api/push-subscription/{id}

Disable a push destination.

**Response 200**:
```json
{ "ok": true }
```

**Response 403** (not owner):
```json
{
  "error": { "code": "FORBIDDEN", "message": "Subscription does not belong to current user" }
}
```

**Response 404**:
```json
{
  "error": { "code": "NOT_FOUND", "message": "Subscription not found" }
}
```

**Behavior**:
- Sets `enabled = 0` (soft delete). Does not hard-delete the row.
- Must verify `user_id` matches the current user.
- The client should also call `PushManager.unsubscribe()` locally.

---

## GET /api/web/vapid-public-key

Public endpoint for the service worker / client to fetch the server's VAPID public key.

**Response 200**:
```json
{
  "public_key": "BPb...base64..."
}
```

**Notes**: No authentication required. The VAPID public key is public by design. The client needs this to call `PushManager.subscribe({ applicationServerKey })`.

---

## POST /api/push-subscription/suppress

Tell the server that a specific push destination has an active foreground client (so suppress push to this destination).

**Request**:
```json
{
  "subscription_id": 1
}
```

**Response 200**:
```json
{ "ok": true }
```

**Behavior**:
- Sent by the frontend when a WebSocket connection is established for a user that has push subscriptions.
- The server tracks active destinations in the WS session state.
- When the WS disconnects, the suppression is automatically lifted.
- Only suppresses push to this specific destination — other destinations for the same user still receive push.

---

## Web App Manifest

Served at `GET /manifest.json` (static file or route handler).

```json
{
  "name": "Seki",
  "short_name": "Seki",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#ffffff",
  "theme_color": "#1a1a2e",
  "orientation": "any",
  "scope": "/",
  "icons": [
    {
      "src": "/static/images/icon-192.png",
      "sizes": "192x192",
      "type": "image/png"
    },
    {
      "src": "/static/images/icon-512.png",
      "sizes": "512x512",
      "type": "image/png"
    }
  ]
}
```

---

## Service Worker

Served at `GET /sw.js` (static file, built by esbuild).

The service worker handles:
1. `push` events → `self.registration.showNotification(title, options)`
2. `notificationclick` events → focus existing window or open new, navigate to `data.gameId`
3. `install` events → precache app shell resources
4. `fetch` events → cache-first for static, network-first for `/api/*`

**Push message payload** (JSON sent by server via `web-push`):
```json
{
  "title": "Your turn",
  "body": "Alice played in Game #42",
  "icon": "/static/images/icon-192.png",
  "badge": "/static/images/icon-192.png",
  "data": {
    "type": "your_turn",
    "gameId": 42,
    "url": "/games/42"
  }
}
```
