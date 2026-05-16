# Data Model: PWA Auth and Push

**Date**: 2026-05-16

## New Tables

### `app_credentials`

Tracks issued JWT identifiers (`jti`) for revocation. The actual JWT token lives in the client's `localStorage` — this table only stores the metadata needed to verify a token hasn't been revoked.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | `INTEGER` | `PRIMARY KEY AUTOINCREMENT` | |
| `user_id` | `INTEGER` | `NOT NULL REFERENCES users(id) ON DELETE CASCADE` | FK to users |
| `jti` | `TEXT` | `NOT NULL UNIQUE` | Matches the JWT `jti` claim |
| `expires_at` | `TEXT` | `NOT NULL` | Matches the JWT `exp` claim (ISO 8601) |
| `revoked` | `INTEGER` | `NOT NULL DEFAULT 0` | 1 if explicitly revoked (logout) |
| `created_at` | `TEXT` | `NOT NULL DEFAULT current_timestamp` | |

**Indexes**:
- `idx_app_credentials_jti` UNIQUE on `jti`
- `idx_app_credentials_user_id` on `user_id`

**Lifecycle**:
1. **Created**: When a JWT is issued (login, register, first visit, or credential renewal). The `jti` row is inserted with `revoked = 0`.
2. **Validated**: On `GET /api/auth/restore`, the server finds the row by `jti` and checks `revoked = 0` and `expires_at` is in the future.
3. **Renewed**: On successful restoration, the old `jti` row is marked `revoked = 1` and a new row is inserted with a fresh `jti` and `expires_at`.
4. **Revoked**: On explicit logout, ALL `app_credentials` rows for the user are set `revoked = 1`.
5. **Expired**: Rows past `expires_at` are rejected. Periodic cleanup can prune expired rows.

**Validation rules**:
- JWT `jti` must match a row where `revoked = 0`
- JWT `exp` must be in the future
- JWT `sub` must reference an existing `users` row
- JWT signature must be valid (HMAC-SHA256)

---

### `push_destinations`

Stores Web Push subscription records per user per device/browser instance.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | `INTEGER` | `PRIMARY KEY AUTOINCREMENT` | |
| `user_id` | `INTEGER` | `NOT NULL REFERENCES users(id) ON DELETE CASCADE` | FK to users |
| `endpoint` | `TEXT` | `NOT NULL` | Push service endpoint URL |
| `p256dh` | `TEXT` | `NOT NULL` | Client public key (base64) |
| `auth` | `TEXT` | `NOT NULL` | Client auth secret (base64) |
| `user_agent` | `TEXT` | | Browser/device identification string |
| `enabled` | `INTEGER` | `NOT NULL DEFAULT 1` | Whether push is active for this destination |
| `last_delivered_at` | `TEXT` | | ISO 8601 timestamp of last successful delivery |
| `last_failure_at` | `TEXT` | | ISO 8601 timestamp of last delivery failure |
| `failure_reason` | `TEXT` | | Reason for last failure (for diagnostics) |
| `created_at` | `TEXT` | `NOT NULL DEFAULT current_timestamp` | |
| `updated_at` | `TEXT` | `NOT NULL DEFAULT current_timestamp` | |

**Indexes**:
- `idx_push_destinations_user_id` on `user_id`
- `idx_push_destinations_endpoint` UNIQUE on `endpoint` (one subscription per endpoint — push services reject duplicates)

**Lifecycle**:
1. **Created**: Client calls `POST /api/push-subscription` with subscription JSON. Server validates (endpoint + keys present, endpoint looks like a valid push URL). Stores with `enabled = 1`.
2. **Updated**: If same endpoint already exists for this user, update `p256dh`, `auth`, `user_agent`, reset failure state.
3. **Disabled**: Client calls `DELETE /api/push-subscription/{id}` or via settings UI. Sets `enabled = 0`. (Soft delete to preserve history.)
4. **Expired**: Delivery fails with 404 or 410 status → mark destination for cleanup (set `enabled = 0`, log failure). The push service has revoked the subscription.
5. **Reactivated**: If user re-subscribes with the same endpoint, re-enable and update keys.

**Validation rules**:
- `endpoint` must be a valid HTTPS URL (push services require HTTPS)
- `p256dh` and `auth` must be non-empty base64 strings
- `user_id` must be the same user making the API request (CB-004: same-user ownership)
- Anonymous users can register push destinations (FR-011a)

**Per-user limits**: Maximum 10 push destinations per user (prevent abuse). Enforced at insertion.

---

### `vapid_config`

Stores the VAPID keypair used for push notification authentication with browser push services.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | `INTEGER` | `PRIMARY KEY AUTOINCREMENT` | |
| `private_key` | `TEXT` | `NOT NULL` | Base64-encoded VAPID private key |
| `public_key` | `TEXT` | `NOT NULL` | Base64-encoded VAPID public key |
| `subject` | `TEXT` | | Contact URL or mailto: for push service identification |
| `created_at` | `TEXT` | `NOT NULL DEFAULT current_timestamp` | |

**Single-row table**: Only one VAPID keypair is active. On startup, if env vars are provided, use those; otherwise read from DB; otherwise generate and insert.

---

## Entity Relationships

```
users
 ├── 1:N ── app_credentials (via user_id, CASCADE)
 ├── 1:N ── push_destinations (via user_id, CASCADE)
 └── 1:1 ── rating_profiles (unchanged)
```

## State Transitions

### App Credential
```
[Issued: revoked=0] ──restored──▶ [Revoked: revoked=1] + [New jti Issued]
       │                                  │
       │                                  ├──revoked + expired──▶ [Rejected]
       │                                  │
       │                                  └──user deleted──▶ [CASCADE deleted]
       │
       ├──logout──▶ [Revoked: revoked=1]
       │
       └──expired──▶ [Rejected on next use]
```

Note: On each successful restoration, the old `jti` is revoked and a new one is issued (rolling 90-day expiry).

### Push Destination
```
[Created] ──enabled──▶ [Active]
    │                    │
    │                    ├──disabled──▶ [Inactive: enabled=0]
    │                    ├──delivery fail (404/410)──▶ [Inactive + logged]
    │                    └──reactivated──▶ [Active: enabled=1]
    │
    └──DELETED──▶ [Hard delete]
```

---

## Migration

New migration file: `seki-web/migrations/003_pwa_push.sql`

```sql
create table app_credentials (
    id integer primary key autoincrement,
    user_id integer not null references users(id) on delete cascade,
    jti text not null,
    expires_at text not null,
    revoked integer not null default 0,
    created_at text not null default current_timestamp
);

create unique index idx_app_credentials_jti on app_credentials(jti);
create index idx_app_credentials_user_id on app_credentials(user_id);

create table push_destinations (
    id integer primary key autoincrement,
    user_id integer not null references users(id) on delete cascade,
    endpoint text not null,
    p256dh text not null,
    auth text not null,
    user_agent text,
    enabled integer not null default 1,
    last_delivered_at text,
    last_failure_at text,
    failure_reason text,
    created_at text not null default current_timestamp,
    updated_at text not null default current_timestamp
);

create index idx_push_destinations_user_id on push_destinations(user_id);
create unique index idx_push_destinations_endpoint on push_destinations(endpoint);

create table vapid_config (
    id integer primary key autoincrement,
    private_key text not null,
    public_key text not null,
    subject text,
    created_at text not null default current_timestamp
);
```

---

## Preference Keys (existing `users.preferences` JSON)

These existing keys drive push notification eligibility for registered users:

| Key | Type | Used For |
|-----|------|----------|
| `notify_your_turn_app` | boolean | Your-turn push eligibility |
| `notify_your_turn_corr_app` | boolean | Correspondence-turn push eligibility |
| `notify_challenge_app` | boolean | New-challenge push eligibility |
| `notify_message_app` | boolean | New-message push eligibility |

Note: The `*_email` keys remain unused (email notification dispatch is not in scope for this feature). The `notifications` key (`"on"`/`"off"`) is browser-local and controls OS permission state.

For anonymous users, push eligibility is determined by browser-local state (Notification permission + `localStorage` "seki:notifications" === "on"). No preference keys are checked server-side for anonymous users.
