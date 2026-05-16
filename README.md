# Seki [^1]

A web app for playing Go (Weiqi/Baduk), built with Rust and Preact.

## Tech Stack

- **Backend:** Rust (Axum 0.8, sqlx 0.8, Askama templates, tower-sessions)
- **Frontend:** Preact 10, TypeScript, esbuild
- **Game engine:** Pure Rust library (`go-engine`) with WASM bridge (`go-engine-wasm`) for client-side logic
- **Database:** SQLite
- **Real-time:** WebSocket (single `/ws` endpoint for game channels and lobby events)

## Architecture

Cargo workspace with three crates:

| Crate            | Purpose                                                                        |
| ---------------- | ------------------------------------------------------------------------------ |
| `go-engine`      | Pure game logic library (board state, rules, scoring, SGF, game tree)          |
| `go-engine-wasm` | Thin wasm-bindgen shell for browser use                                        |
| `seki-web`       | Axum web app (routes, models, services, WebSocket, templates, Preact frontend) |

## Getting Started

```bash
# Prerequisites: Rust, Node 24+, pnpm

# Build WASM engine
wasm-pack build go-engine-wasm --target web --out-dir seki-web/static/wasm

# Build frontend
cd seki-web/frontend && pnpm install && pnpm run build && cd ../..

# Run the server
cargo run -p seki-web --bin seki-web  # http://localhost:3000
```

## Prebuilt Deploy

If you do not want Rust, Node, `pnpm`, or `wasm-pack` on the Pi, build locally and ship a release tarball over SSH.

```bash
# First deploy from your local machine
./scripts/deploy-prebuilt.sh

# Then adjust runtime config on the Pi if needed
ssh nilueps@pi.local '$EDITOR ~/.config/seki/seki.env && systemctl --user restart seki'
```

What this flow does:

- installs `~/.config/systemd/user/seki.service`
- builds WASM, frontend assets, and the release `seki-web` binary locally
- uploads a tarball plus helper scripts to the Pi over SSH
- installs each deploy into `~/seki/releases/<timestamp>`
- updates `~/seki/current` and restarts the `seki` user service

Required on the Pi: `tar` and a running user systemd session.
Required on your local machine: `ssh`, `scp`, Rust, `pnpm`, and `wasm-pack`.
If the service should stay up after logout, enable lingering for the deploy user with `sudo loginctl enable-linger nilueps`.

Notes:

- `./scripts/deploy-prebuilt.sh` builds locally, then uploads the release to `nilueps@pi.local` by default.
- Override `DEPLOY_HOST` if you need a different SSH target, or `APP_DIR` if you want a different remote install path.
- For Tailscale Funnel, set `BASE_URL=https://pi.basilisk-aeolian.ts.net` and `ENVIRONMENT=production` in `~/.config/seki/seki.env`.
- `BASE_URL` is used for generated invite email links; it is not used for routing.
- The deploy build always targets the Pi's `aarch64-unknown-linux-gnu` architecture.
- The Rust release build always runs inside the `seki-build` Ubuntu 24.04 toolbox, and the script will create it if needed.
- The script provisions `crossbuild-essential-arm64` and `pkg-config` inside the toolbox automatically and runs `rustup target add aarch64-unknown-linux-gnu` there.
- The frontend, WASM, and tarball packaging steps still run on the host, so your host still needs `pnpm` and `wasm-pack`.
- On Bluefin, the intended deploy command is now just: `./scripts/deploy-prebuilt.sh`

## Features

### Gameplay

- [x] Create games (board size, komi, handicap, color choice, nigiri, private/public/invite-only)
- [x] Negative komi support
- [x] Join open games
- [x] Play moves, pass, resign
- [x] Undo/takeback requests (with opponent approval)
- [x] Territory review (mark dead stones, approve scoring)
- [x] Ko rule enforcement
- [ ] Superko detection (prevent repeated board positions)
- [x] Invite players by email or username
- [x] Challenge players (user search with presence indicators)
- [x] Open game restrictions (anyone, registered only)
- [x] Challenge players from profile
- [x] Abort game (before first move)
- [x] Game clocks (Fischer, byo-yomi, correspondence)
- [x] Detect player disconnect and claim-victory flow
- [x] Rematch option after game
- [x] Monte Carlo dead stone detection
- [ ] Multiple rulesets (Japanese, Chinese, AGA)
- [ ] Conditional moves (pre-plan responses, useful for correspondence)
- [x] Score estimator (territory estimate from analysis mode)
- [ ] Vacation/pause system (for correspondence games)
- [x] Turn notification (tab title flash when it's your turn)
- [x] Turn notifications (email/push) — push notifications implemented
- [ ] Players can agree to postpone timed game

### Board & Navigation

- [x] Move history navigation (arrow keys, home/end)
- [x] Move tree visualization with branches and active path highlighting
- [x] In-game analysis mode (local exploration without affecting live game)
- [x] Standalone analysis board (`/analysis`)
- [x] Analysis persistence (saved to localStorage, restored on refresh)
- [ ] Server-backed analysis persistence and merge-sync
- [x] Last move and ko point markers
- [x] Player labels with capture counts
- [x] Online presence indicators (player labels and chat)
- [x] Tab title shows game description, flashes "YOUR MOVE" when it's your turn
- [x] Move confirmation toggle (click twice to confirm)
- [ ] Board annotations in analysis
- [ ] Editable player names on the analysis board
- [x] Board coordinates (toggleable)
- [x] Import/export SGF
- [ ] Zen mode (board only)
- [ ] Appearance customization (stones, board)
- [ ] High-contrast mode
- [x] Dark mode with theme toggle (light/dark/auto)
- [x] Touch crosshair input for mobile
- [x] Sound effects (stone placement, pass)
- [ ] Additional sounds (capture, clock, chat)

### Real-time

- [x] Unified WebSocket (`/ws`) for game channels and lobby events
- [x] In-game chat with move-linked messages
- [x] Live games list
- [x] Spectator support for games
- [ ] Pre-start spectate flow for open/challenge games
- [ ] Room user list on the game page
- [x] Filter games list (unranked, rank range)
- [ ] Filter games list (time, size)
- [ ] Auto-match system
- [x] In-app notification system for unread games
- [x] Notification settings and OS notification toggle
- [x] Post-game collaborative presentation mode
- [ ] Spectator count/list on games
- [ ] Tournament support (brackets, pairings, scheduling)

### Auth & Accounts

- [x] Anonymous play (auto-created sessions)
- [x] Registration (username/password)
- [x] Login/logout with session persistence
- [x] Browser app credentials (JWT with 90-day rolling expiry for PWA identity persistence)
- [x] Settings page with API token management
- [x] Basic user profile and game history
- [ ] User profile customization
- [x] Username changes from profile
- [x] User online status (presence indicators in game, chat, and user search)
- [ ] Friend requests / friends list
- [ ] Rich user labels (rank/friend/bot indicators)
- [x] Ranking system (Glicko-2 rating with kyu/dan labels)
  - [x] Ranked/unranked game option

### API

- [x] REST API with Bearer token authentication
- [x] Game CRUD, moves, pass, resign, undo, territory, chat, turns
- [x] Public endpoints for public game data (list/get games, messages, turns) without auth
- [x] Structured JSON error envelopes with machine-readable error codes
- [ ] Versioning
- [x] Docs (OpenAPI via Scalar)
  - [ ] Generated clients
- [x] Rate limiting
- [ ] Bots

### Social

- [ ] Channels (users can create and join)
  - [ ] Public and private (invite only)
  - [ ] Mod users (crown symbol)
  - [ ] Lobby chat
  - [ ] 1-on-1 chat
- [ ] Flagging/reporting system (cheaters, spammers, over-zealous reporters, etc)
  - [ ] 3 strike policy
- [ ] Voice chat

### Learning & Review

- [ ] Problems/puzzles
- [ ] Tutorials
- [ ] Post-game reviews (live analysis)
- [ ] Live demonstrations/lessons with voice
- [ ] Game reviews/lessons save and replay
- [ ] AI review integration (KataGo or similar)

### Game Variants

- [ ] Irregular boards (non-square, edgeless/torus)
- [ ] Game variations (>2 players, gomoku)

### Infrastructure

- [x] Email support (SMTP; Mailpit in local development)
- [ ] Domain registration and deployment
- [x] Mobile-responsive design (tabbed layout, hamburger menu)
- [x] PWA install support (web manifest, service worker, offline shell)

[^1]: "Seki" is a Japanese go term meaning _mutual life_. It is a situation where two groups of stones share liberties which neither player can fill without dying.
