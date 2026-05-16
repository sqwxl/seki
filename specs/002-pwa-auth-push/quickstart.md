# Quickstart: PWA Auth and Push

## Prerequisites

- Rust toolchain (edition 2024)
- Node 24 with pnpm
- Docker (optional, for containerized dev)
- A browser that supports Service Workers and Push API (Chrome 50+, Firefox 44+)
- For push testing: a browser that supports Push API over localhost (Chrome) or use a tunnel service

## New Dependencies

Add to `seki-web/Cargo.toml`:
```toml
jsonwebtoken = "9"
web-push = "0.11"
```

Regenerate `Cargo.lock`:
```bash
cargo update -p seki-web
```

## Setup

### 1. Run the migration

```bash
# The migration runs automatically on app startup.
# Or run manually:
cargo run -- migrate
```

### 2. Build the WASM engine (unchanged)

```bash
wasm-pack build go-engine-wasm --target web --out-dir seki-web/static/wasm
```

### 3. Build the frontend

```bash
cd seki-web/frontend
pnpm install
pnpm run build          # production build: bundle.js + sw.js
```

### 4. Generate VAPID keys (if not using env vars)

On first startup, the server auto-generates and stores VAPID keys in the `vapid_config` table. To pre-generate for production:

```bash
# One-time generation:
openssl ecparam -name prime256v1 -genkey -noout -out vapid_private.pem
openssl ec -in vapid_private.pem -pubout -outform DER | tail -c 65 | base64 | tr -d '=' | tr '/+' '_-' > vapid_public.txt
openssl ec -in vapid_private.pem -outform DER | tail -c 32 | base64 | tr -d '=' | tr '/+' '_-' > vapid_private.txt
```

Then set env vars:
```bash
export VAPID_PRIVATE_KEY=$(cat vapid_private.txt)
export VAPID_PUBLIC_KEY=$(cat vapid_public.txt)
```

### 4b. JWT signing secret

Set a 32-byte base64 secret for HMAC-SHA256 JWT signing. If not set, the server auto-generates one on first startup and stores it in the `vapid_config` table alongside VAPID keys.

```bash
# Generate:
openssl rand -base64 32
export APP_CREDENTIAL_SECRET="<output>"
```

### 5. Run the dev server

```bash
cargo run
# or with Docker:
docker compose up
```

## Testing

### Rust tests

```bash
cargo test -p seki-web                    # all web tests
cargo test -p seki-web -- app_credential  # credential tests
cargo test -p seki-web -- push            # push service tests
cargo check --all                         # type-check all crates
```

### Frontend tests

```bash
cd seki-web/frontend
pnpm run typecheck                        # TypeScript type-check
pnpm test                                 # Vitest tests
```

### Manual PWA testing

1. Open Chrome DevTools → Application → Manifest tab → verify manifest loads
2. Application → Service Workers tab → verify SW registers
3. Lighthouse → PWA audit → should pass baseline installable criteria
4. Install the app: Chrome menu → "Install Seki..."
5. Log in, close the app, reopen → verify session persists
6. Enable notifications, close all tabs → trigger a move from another account → verify push notification arrives

### Manual push testing on localhost

Chrome allows Push API on localhost without HTTPS. For remote testing, use `ngrok` or similar tunnel:

```bash
ngrok http 3000
# Then set BASE_URL to the ngrok URL
```

## Key Files

| File | Purpose |
|------|---------|
| `seki-web/migrations/003_pwa_push.sql` | New tables: app_credentials (jti), push_destinations, vapid_config |
| `seki-web/src/models/app_credential.rs` | JWT jti tracking and revocation |
| `seki-web/src/models/push_destination.rs` | Push subscription DB access |
| `seki-web/src/services/push.rs` | Push delivery dispatch service |
| `seki-web/src/routes/auth.rs` | Extended: JWT issue/restore/revoke endpoints |
| `seki-web/src/routes/push.rs` | Push subscription API endpoints |
| `seki-web/static/manifest.json` | Web app manifest |
| `seki-web/frontend/src/app.tsx` | Extended: credential restore on mount, localStorage |
| `seki-web/frontend/src/service-worker.ts` | Service worker source |
| `seki-web/frontend/src/push.ts` | Push subscription management (client-side) |

## Verification Checklist

- [ ] `cargo build` succeeds with new dependencies
- [ ] `cargo test -p seki-web` passes
- [ ] `pnpm run typecheck` passes
- [ ] `pnpm test` passes
- [ ] `pnpm run build` produces `static/dist/bundle.js` and `static/dist/sw.js`
- [ ] Manifest loads in browser DevTools
- [ ] Service worker registers without errors
- [ ] `seki:app_credential` is stored in `localStorage` on login/first visit
- [ ] Credential restores session on PWA restart (manual test)
- [ ] Push subscription can be created and deleted via API
- [ ] Push notification arrives when all Seki tabs are closed
- [ ] Notification click navigates to the correct game
- [ ] Offline shell shows meaningful UI when network is unavailable
- [ ] Existing notification bell and unread tracking still work
- [ ] Existing real-time WS updates still work
