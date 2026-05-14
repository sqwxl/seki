# API Specification

## Purpose

This document defines server-side API behavior for `seki-web`, especially requirements that must hold even when clients bypass the browser UI.

It complements [FRONTEND_SPEC.md](/var/home/sqwxl/Projects/seki/FRONTEND_SPEC.md):

- `FRONTEND_SPEC.md` defines browser-client behavior
- `API_SPEC.md` defines HTTP/API and server-side validation behavior

## Validation

### SGF Import

- The server must reject SGF imports for non-square boards.
- This validation must be enforced server-side, not only in the browser.

## Access Control

Public game data may be read without authentication. Private and invite-protected games must not leak through API or WebSocket clients that bypass the browser UI.

Expected behavior:

- public game list endpoints include only public, non-invite-protected games
- game detail, messages, turns, user game history, and WebSocket room subscription require authorization when a game is private or invite-protected
- authorization is granted by being the creator/player for the game or by presenting a valid `access_token` or `invite_token`
- unauthorized protected game reads should not reveal that the game exists
- bearer-token API clients are not browser clients; CORS should remain closed by default unless a specific trusted browser origin is added later

## Abuse Controls

Public deployments should apply standard request throttling at the application or trusted reverse proxy boundary.

Expected behavior:

- login and registration are strictly rate limited per client IP
- game creation and WebSocket connection attempts are moderately rate limited per client IP
- unauthenticated public reads may use broader per-IP limits
- rate limited responses use `429 Too Many Requests` and include `Retry-After`
- forwarded client IP headers are trusted only when the app is behind a trusted reverse proxy

## Deployment Origins

`BASE_URL` is the externally reachable origin used when the server generates links, currently invite email links.

Expected behavior:

- production deployments set `ENVIRONMENT=production` so session cookies are secure
- public deployments set `BASE_URL` to the public origin, for example `https://pi.basilisk-aeolian.ts.net`
- `BASE_URL` is not used for request routing or API authentication

## Error Responses

API errors should be structured for programmatic clients rather than relying on ad hoc message strings.

Expected behavior:

- error responses use consistent HTTP status semantics
- JSON error responses use a consistent envelope shape
- machine-readable error codes are included for client handling
- human-readable error messages may be included, but are not the only structured error signal
