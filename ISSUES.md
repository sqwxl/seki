# Issues

## 1. Auth & Sessions

- [ ] Logout should redirect just like login `[test: backend:integration]`
- [ ] Bearer token works on all authenticated API endpoints (untested) `[test: backend:integration]`
- [ ] Token always shown on settings page — potential security issue

## 2. Game Creation

### Board Size
- [ ] Size outside 5-19 range rejected `[test: backend:integration]`
- [ ] API should not accept negative board dimensions (apparent overflow) `[test: backend:integration]`
- [ ] API should not accept 0x0 board dimensions `[test: backend:integration]`
- [ ] API should not accept arbitrary board dimensions; should be clamped `[test: backend:integration]`

### Komi
- [ ] Default komi works (6.5 for no handicap) `[test: backend:unit]`
- [ ] Integer komi rejected (0, 1, -1) `[test: backend:integration]`
- [ ] Default komi in form is 0.5; consider changing default with board size
- [ ] Integer komi should be rejected via both web and API `[test: backend:integration]`

### Handicap
- [ ] API should not accept negative handicap `[test: backend:integration]`
- [ ] API should not accept arbitrary handicap `[test: backend:integration]`
- [ ] API should not accept illegal handicap for board size `[test: backend:integration]`
- [ ] UI should show 0 and 1 to avoid confusion

### Time Control
- [ ] Timer appears to skip a second when starting periods (should round up) `[test: frontend:unit]`
- [ ] Restored time control choice in game form should correctly set radio input (shows settings but "None" is selected)
- [ ] Timer color switches to red for t < 10s
- [ ] Timer format switches to seconds.millis for last t < 10s `[test: frontend:unit]`

### Visibility
- [ ] Private game should only be visible to participants (challengee, or via invite token); currently visible to anyone with the game ID `[test: backend:integration]`

### Invitations
- [ ] Invite by email: sends invite (if email support active)
- [ ] Invite link `/games/:id?token=...` grants access to private game `[test: backend:integration]`
- [ ] Invite link required to join private games `[test: backend:integration]`
- [ ] New game form needs invite by username (via user search)
- [ ] Email invite and notification (needs local service to test)

## 3. Game Lobby / Games List

- [ ] Pending outgoing challenges should appear in Challenges section; currently only visible for the challengee `[test: e2e:ws]`
- [ ] Newly created game appears in list, but not in same order as full refresh `[test: e2e:ws]`

## 4. Joining Games

- [ ] Cannot join private game without invite token `[test: backend:integration]`
- [ ] Cannot join a game that is already finished/aborted `[test: backend:integration]`

## 5. Challenges

- [ ] Declined status should show in GameStatus component `[test: frontend:unit]`

## 6. Playing Moves

### Move Confirmation Mode
- [ ] Premove cleared on pass or turn change `[test: frontend:unit]`
- [ ] "Confirm move" button should not shift layout
- [ ] Premove ghost should be cleared on pass or turn change `[test: frontend:unit]`
- [ ] Premove ghost should not trigger immediate move on turn change; premove context is only relevant during a player's turn `[test: frontend:unit]`

## 7. Passing

- [ ] Consecutive pass handling flaky; territory review phase can be lost on refresh `[test: e2e:ws]`

## 8. Resigning

- [ ] System chat message "Game over. {result}" broadcast on resign `[test: e2e:ws]`
- [ ] Resign button should be disabled until the first move is played; currently possible to resign after accepting/joining, leading to broken state (result not set, GameStatus not shown, game still playable) `[test: backend:integration]`

## 9. Aborting

- [ ] Only creator should be able to abort pending challenge; opponent can abort via API `[test: backend:integration]`
- [ ] "Game aborted" system chat message should include username ("Game aborted by $user") `[test: e2e:ws]`
- [x] Player should not be able to abort as soon as player reconnects (UI should immediately update) `[test: e2e:ws]` *(disconnect.rs: disconnect_abort_threshold + capabilities.test.ts: disconnect abort timing)* **NOTE: significant frontend lag observed showing disconnected status updates — server-side thresholds are tested but UI responsiveness is not**

## 10. Undo / Takeback

### Requesting
- [ ] Requester sees "undo_request_sent" (button disabled) `[test: e2e:ws]`
- [ ] Undo button should be disabled with "Request pending" tooltip while outgoing request is pending `[test: e2e:ws]`
- [ ] Undo requested dialogue should be dismissed if own move played via API `[test: e2e:ws]`
- [ ] Undo button should be disabled after a pass `[test: frontend:unit]`
- [ ] Undo button should be re-enabled if state now allows undo request for player `[test: frontend:unit]`

### Responding
- [ ] Both clocks should reset to time when undone move was played `[test: e2e:ws]`

### Edge Cases
- [ ] Multiple rapid undo requests handled correctly (unclear how to test) `[test: backend:integration]`

## 11. Territory Review

### Entry
- [ ] Moves should not be playable from territory review; currently sometimes possible, leading to out-of-sync board states `[test: backend:integration, e2e:ws]`
- [ ] Player stones in UserLabel should remain unchanged during territory review (currently reverts to BW icon) `[test: frontend:unit]`

### Dead Stone Toggling
- [ ] Captures and territory for each player updated in player panels `[test: e2e:ws]`

### Territory Approval
- [ ] System message reads: "Territory will be auto-confirmed in $TIME" `[test: e2e:ws]`
- [ ] Cannot approve if already approved (should not be possible via web or API) `[test: backend:integration]`
- [ ] Clicking empty vertex (not a stone) during territory review: no action (currently resets approval and countdown timer) `[test: e2e:ws]`

### Scoring
- [ ] Dead stones counted as captures for opponent (not verified) `[test: backend:unit]`
- [ ] Player panel shows territory and (captures + dead stones) `[test: e2e:ws]`

## 12. Clock / Timer

### Byo-yomi
- [ ] Each period resets if move made within period time `[test: backend:unit]`
- [ ] Last period is '(1)' — no zero-th period after `[test: backend:unit, frontend:unit]`

### Correspondence
- [ ] No real-time countdown (async play)
- [ ] Real-time countdown in final hour

### Clock Pausing
- [x] Opponent clock pauses as soon as opponent disconnects `[test: e2e:ws]` *(disconnect.rs: clock_pauses_on_disconnect)*
- [x] Clock resumes when opponent reconnects `[test: e2e:ws]` *(disconnect.rs: reconnect_broadcasts_player_reconnected)*

### Edge Cases
- [ ] Very fast moves: increment still applied correctly (not tested) `[test: backend:unit]`
- [x] Disconnect during opponent's turn: their clock paused `[test: e2e:ws]` *(disconnect.rs: move_while_opponent_disconnected_keeps_clock_paused)*

## 13. Chat

- [ ] Users require invite token to post to private game chat `[test: backend:integration]`

## 14. Move Navigation

### Keyboard
- [ ] Up arrow: jump to start (empty board) `[test: frontend:unit]`
- [ ] Down arrow: jump to latest move `[test: frontend:unit]`

### Button Controls
- [ ] Client should not crash when navigating after returning from chat or analysis tab (infinite recursion in live-game.tsx) `[test: e2e]`

### Move Tree
- [ ] Current position highlighted `[test: frontend:unit]`
- [ ] Active path highlighted `[test: frontend:unit]`
- [ ] Territory node with final territories
- [ ] Auto-scroll to keep current node visible

## 15. Analysis Mode

### In-Game Analysis
- [ ] Analysis tree restored on refresh `[test: e2e]`
- [ ] Load local move tree + live state on load into live game `[test: e2e]`
- [ ] Move confirmation works in analysis mode `[test: e2e]`

### Standalone Analysis Page
- [ ] Player names editable

### Score Estimator
- [ ] Exit estimate returns to normal board view `[test: e2e]`
- [ ] "Accept" ends branch with final territory node
- [ ] "Estimate score" button on node before final territory simply moves to that node (bypass review flow)

### SGF Import
- [ ] Non-square board SGF rejected with error (untested) `[test: backend:unit, frontend:unit]`
- [ ] Unsupported board sizes rejected (untested) `[test: backend:unit, frontend:unit]`

### SGF Export
- [ ] Filename: "{YYYYMMDD}-{Black}-vs-{White}.sgf" for games, "analysis.sgf" standalone without set names `[test: frontend:unit]`

## 16. Presentation Mode (Post-Game) — Currently Broken

- [ ] "Analyze" button on finished game starts presentation `[test: e2e:ws]`
- [ ] Only available on finished games `[test: e2e:ws]`
- [ ] Originator enters analysis mode `[test: e2e:ws]`
- [x] All connected users receive `presentation_started` `[test: e2e:ws]` *(presentation.rs: start_and_end_presentation)*
- [x] Presenter's board state broadcast to all viewers `[test: e2e:ws]` *(presentation.rs: presenter_sends_snapshots)*
- [x] Viewers see real-time board updates as presenter navigates `[test: e2e:ws]` *(presentation.rs: presenter_sends_snapshots)*
- [ ] Move tree position synced for synced viewers `[test: e2e:ws]`
- [x] Originator can give control to another user `[test: e2e:ws]` *(presentation.rs: give_control)*
- [x] Non-originator can request control `[test: e2e:ws]` *(presentation.rs: request_control)*
- [ ] Originator sees request popover with give/dismiss buttons
- [x] Control request can be cancelled `[test: e2e:ws]` *(presentation.rs: cancel_request)*
- [x] Control request can be rejected `[test: e2e:ws]` *(presentation.rs: reject_request)*
- [x] Only originator can `take_control` back `[test: e2e:ws]` *(presentation.rs: non_originator_cannot_take_control)*
- [ ] Delegated presenter: exiting analysis gives control back to originator `[test: e2e:ws]`
- [ ] Viewers can choose: follow presentation or analyze locally `[test: e2e:ws]`
- [ ] Local analysis doesn't affect presentation `[test: e2e:ws]`
- [ ] Switching to local analysis un-syncs from presentation `[test: e2e:ws]`
- [ ] Can re-sync to presentation `[test: e2e:ws]`
- [x] Originator exits analysis to end presentation `[test: e2e:ws]` *(presentation.rs: start_and_end_presentation)*
- [x] All viewers receive `presentation_ended` `[test: e2e:ws]` *(presentation.rs: start_and_end_presentation)*
- [ ] Board returns to last game position for viewers `[test: e2e:ws]`

## 17. Rematch

- [ ] Rematch available via both web and API (untested) `[test: backend:integration]`

## 18. UI / Display

### Player Panels
- [x] Opponent always in top panel (also for open games) `[test: frontend:unit]` *(capabilities.test.ts: player panel ordering)*
- [ ] Territory for completed games with territory `[test: e2e]`

### Mobile / Responsive
- [ ] Board resizes dynamically when window is resized (both mobile and desktop layouts)
- [ ] Board resizes dynamically with surrounding UI shifts (layout shift incorrect when opponent joins; bottom label obscured)
- [ ] Move tree direction adjusts depending on container dimensions
- [ ] Layout should use available width when window height is small in mobile mode (stacked controls on one row)
- [ ] Board is centred when shrunk in short mobile layout

### Tab Title
- [ ] Tab notification only enabled by receiving live move; not by changing tab or any other action `[test: e2e]`

## 19. Sound Effects

- [ ] Placing a stone manually triggers sound in analysis

## 20. WebSocket Connection

- [ ] Pending messages queued and sent on reconnect (untested) `[test: e2e:ws]`
- [x] Online user list updated on connect/disconnect `[test: e2e:ws]` *(presence.rs: join_broadcasts_presence, disconnect_broadcasts_offline)*
- [ ] Multiple tabs maintain separate connections `[test: e2e:ws]`
- [ ] Graceful handling of server restart `[test: e2e:ws]`
- [ ] Disconnected client optimistically shows played move if disconnected during player's turn
- [x] Presence indicators update immediately for all subscribers `[test: e2e:ws]` *(presence.rs: multiple_connections_no_false_offline)*

## 21. REST API — Needs Thorough Automated Testing

### Public Endpoints
- [ ] `GET /api/games` lists public games (no auth needed) `[test: backend:integration]`
- [ ] `GET /api/games/:id` returns game state `[test: backend:integration]`
- [ ] `GET /api/games/:id/messages` returns chat messages `[test: backend:integration]`
- [ ] `GET /api/games/:id/turns` returns move history `[test: backend:integration]`
- [ ] `GET /api/users/:username` returns user info `[test: backend:integration]`
- [ ] `GET /api/users/:username/games` returns user's games `[test: backend:integration]`

### Authenticated Endpoints
- [ ] `POST /api/games` creates game `[test: backend:integration]`
- [ ] `DELETE /api/games/:id` deletes unstarted game (creator only) `[test: backend:integration]`
- [ ] `POST /api/games/:id/join` joins game `[test: backend:integration]`
- [ ] `POST /api/games/:id/play` with `{col, row}` plays move `[test: backend:integration]`
- [ ] `POST /api/games/:id/pass` passes `[test: backend:integration]`
- [ ] `POST /api/games/:id/resign` resigns `[test: backend:integration]`
- [ ] `POST /api/games/:id/abort` aborts `[test: backend:integration]`
- [ ] `POST /api/games/:id/undo` requests undo `[test: backend:integration]`
- [ ] `POST /api/games/:id/undo/respond` accepts/rejects undo `[test: backend:integration]`
- [ ] `POST /api/games/:id/territory/toggle` toggles dead chain `[test: backend:integration]`
- [ ] `POST /api/games/:id/territory/approve` approves territory `[test: backend:integration]`
- [ ] `POST /api/games/:id/accept` accepts challenge `[test: backend:integration]`
- [ ] `POST /api/games/:id/decline` declines challenge `[test: backend:integration]`
- [ ] `POST /api/games/:id/rematch` creates rematch `[test: backend:integration]`
- [ ] `POST /api/games/:id/messages` sends chat `[test: backend:integration]`
- [ ] `GET /api/me` returns current authenticated user `[test: backend:integration]`
- [ ] Create endpoints should return 201 `[test: backend:integration]`

### Error Handling
- [ ] 401 for missing/invalid token on authenticated endpoints `[test: backend:integration]`
- [ ] 400 for invalid game actions (wrong turn, game over, etc.) `[test: backend:integration]`
- [ ] 422 for invalid data (wrong type) `[test: backend:integration]`
- [ ] 404 for nonexistent game/user `[test: backend:integration]`
- [ ] JSON error responses with meaningful messages `[test: backend:integration]`
- [ ] Error messages have inconsistent formatting `[test: backend:integration]`
- [ ] Error messages lack machine-readable error codes `[test: backend:integration]`

## 22. Cross-Cutting Edge Cases

- [ ] Two players play simultaneously — race condition on turns (needs automated test) `[test: backend:integration]`
- [ ] Game with 0 komi disallowed `[test: backend:integration]`
- [ ] Very long game (300+ moves): performance acceptable (untested) `[test: backend:integration]`
- [ ] Rapid-fire moves: server handles correctly, no state corruption (needs automated test) `[test: backend:integration]`
- [ ] Network partition during move: move either fully applied or fully rolled back (needs automated test) `[test: backend:integration]`
- [ ] DB transaction failure: engine state rolled back, no DB/cache divergence (needs automated test) `[test: backend:integration]`
- [ ] Two anonymous users in same game, one registers mid-game (needs test) `[test: e2e:ws]`
