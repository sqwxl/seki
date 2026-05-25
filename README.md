# Seki [^1]

A platform for playing Go (Weiqi/Baduk), built with Rust and Preact.

## Architecture

| Crate              | Purpose                                                                                       |
| ------------------ | --------------------------------------------------------------------------------------------- |
| `go-engine`        | Pure game logic library (board state, rules, scoring, SGF, game tree)                         |
| `go-engine-wasm`   | Thin wasm-bindgen shell for browser use                                                       |
| `seki-web`         | Server and web client. Axum (routes, models, services, WebSocket, views, Preact frontend) |
| `seki-client`      | HTTP + WS client                                                                              |
| `seki-gtp`         | Bridge app to interface GTP engines (eg. KataGo) with Seki                                    |
| `seki-api`         | Shared API types for `seki-web` and `seki-client`                                             |
| `seki-random-bots` | QA feature that simulates an active user pool.                                                |
| `seki-android`     | Android client (Kotlin, WebView-based)                                                        |

## Local quickstart

Prerequisites: Rust, Node 24+, pnpm, Cargo binstall

```bash
# install dependencies
just setup

# run
just run

```

Look in `./justfile` for recipe details

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
- [ ] Vacation/pause system (for correspondence games)
- [x] Score estimator (territory estimate from analysis mode)
- [x] Turn notification (tab title flash when it's your turn)
- [x] Turn notifications (email/push) — push notifications implemented
- [ ] Players can agree to postpone timed game
- [ ] Return to game from territory review (e.g., to settle life/death dispute)

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
- [ ] Accessible/High-contrast mode
- [x] Dark mode with theme toggle (light/dark/auto)
- [x] Touch crosshair input for mobile
- [x] Sound effects (stone placement, pass)
- [ ] Additional sounds (capture, clock, chat)

### Real-time

- [x] Unified WebSocket (`/ws`) for game channels and lobby events
- [x] In-game chat with move-linked messages
- [x] Live games list
- [x] Spectator support for games
- [x] Pre-start spectate flow for open/challenge games
- [ ] Room user list on the game page
- [ ] Filter games list (unranked, rank range, size, TC)
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
- [x] Username update from profile
- [x] User online status (presence indicators in game, chat, and user search)
- [x] Rich user labels (rank, bot, presence, etc.)
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
- [ ] AsyncAPI spec for WS API (maybe?)
- [ ] Rate limiting (needs refinement)

### Social

- [ ] Tag favorite users (prioritized in search results, games lists)
- [ ] Flagging/reporting system (cheaters, spammers, over-zealous reporters, etc)
- [ ] Voice chat

### Learning & Review

- [ ] Problems/puzzles
- [ ] Tutorials
- [ ] Post-game reviews (live analysis)
- [ ] Live demonstrations/lessons with voice
- [ ] Game reviews/lessons save and replay
- [ ] AI review integration (KataGo or similar)
- [ ] Offline bot play (i.e., client-side bot)

### Game Variants

- [ ] Irregular boards (non-square, edgeless/torus)
- [ ] Game variations (>2 players, gomoku)

### Infrastructure

- [ ] Domain registration and deployment
- [x] Email support (SMTP; Mailpit in local development)
- [x] Mobile-responsive design
- [x] PWA install support (web manifest, service worker, offline shell)
- [ ] Android client (WIP — see `seki-android/`)
- [ ] iOS client

[^1]: "Seki" is a Japanese go term meaning _mutual life_. It is a situation where two groups of stones share liberties which neither player can fill without dying.
