# Seki [^1]

A web app for playing Go (Weiqi/Baduk), built with Rust and Preact.

## Features

### Gameplay

- [x] Create games (board size, komi, handicap, color choice, private/public)
- [x] Join open games
- [x] Play moves, pass, resign
- [x] Undo/takeback requests (with opponent approval)
- [x] Territory review (mark dead stones, approve scoring)
- [x] Ko rule enforcement
- [ ] Superko detection (prevent repeated board positions)
- [x] Invite players by email
- [x] Abort game (before first move)
- [x] Game clocks (Fischer, byo-yomi, correspondence)
- [x] Premove support (queue move during opponent's turn)
- [ ] Detect player disconnect, pause clock, offer to abort
- [ ] Rematch option after game (challenge opponent to new game with same settings)
- [ ] Multiple rulesets (Japanese, Chinese, AGA)
- [ ] Conditional moves (pre-plan responses, useful for correspondence)
- [ ] Score estimator (mid-game score estimate)
- [ ] Vacation/pause system (for correspondence games)
- [x] Turn notification (tab title flash when it's your turn)
- [ ] Turn notifications (email/push)

### Board & Navigation

- [x] Move history navigation (arrow keys, home/end)
- [x] Move tree visualization with branches and active path highlighting
- [x] In-game analysis mode (local exploration without affecting live game)
- [x] Standalone analysis board (`/analysis`)
- [x] Analysis persistence (saved to localStorage, restored on refresh)
- [x] Last move and ko point markers
- [x] Player labels with capture counts
- [x] Online presence indicators (player labels and chat)
- [x] Tab title shows game description, flashes "YOUR MOVE" when it's your turn
- [x] Move confirmation toggle (click twice to confirm)
- [ ] Board annotations in analysis
- [x] Board coordinates (toggleable)
- [ ] Import/export SGF
- [ ] Zen mode (board only)
- [ ] Appearance customization (stones, board)
- [x] Dark mode (basic, follows system preference)
- [x] Sound effects (stone placement, pass)
- [ ] Additional sounds (capture, clock, chat)

### Real-time

- [x] Unified WebSocket (`/ws`) for game channels and lobby events
- [x] In-game chat with move-linked messages
- [x] Live games list
- [ ] Filter games list (unranked, rank range, time, size)
- [ ] Auto-match system
- [ ] Game playback (replay game as it happened: actions, clock and chat in real time)
- [ ] Spectator count/list on games
- [ ] Tournament support (brackets, pairings, scheduling)

### Auth & Accounts

- [x] Anonymous play (auto-created sessions)
- [x] Registration (username/password)
- [x] Login/logout with session persistence
- [x] Settings page with API token management
- [ ] User profile (avatar, flag, bio, game history, rank history)
- [ ] User profile customization
- [ ] Display names
- [ ] User online status
- [ ] Friends list
- [ ] Ranking system (ELO, kyu/dan)
  - [ ] Ranked/unranked game option

### API

- [x] REST API with Bearer token authentication
- [x] Game CRUD, moves, pass, resign, undo, territory, chat, turns
- [x] Public endpoints (list/get games, messages, turns) without auth
- [ ] Versioning
- [ ] Docs (OpenAPI)
  - [ ] Generated clients
- [ ] Rate limiting
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

- [ ] Email support (via SES)
- [ ] Domain registration and deployment
- [ ] Mobile-responsive design

[^1]: "Seki" is a Japanese go term meaning _mutual life_. It is a situation where two groups of stones share liberties which neither player can fill without dying.
