# Issues

## 0. Misc

- [ ] Reloading live game page must always return to latest live mode position
- [x] Presence indicator updates as soon as a player connects or disconnects _(fix: presence WS messages were missing `game_id` field, causing frontend routing to drop them)_
- [x] Presence indicator correctly reflects player presence _(same root cause)_

## 1. Auth & Sessions

- [x] Logout should redirect just like login `[test: backend:integration]` _(api.rs: logout_html_redirects, logout_json_returns_redirect_field)_
- [x] Bearer token works on all authenticated API endpoints `[test: backend:integration]` _(api.rs: missing_auth_returns_401, invalid_token_returns_401)_
- [ ] Token currently shown in clear on settings page — potential security issue

## 2. Game Creation

### Board Size

- [x] Size outside 2-41 range rejected `[test: backend:integration]` _(validation.rs)_
- [x] API should not accept negative board dimensions (apparent overflow) `[test: backend:integration]` _(validation.rs)_
- [x] API should not accept 0x0 board dimensions `[test: backend:integration]` _(validation.rs)_
- [x] API should not accept arbitrary board dimensions; clamped to 2-41 `[test: backend:integration]` _(api.rs: reject_board_dimensions_outside_range, accept_board_dimensions_within_range)_

### Komi

- [x] Komi is a required parameter; frontend defaults to 6.5 `[test: backend:integration]` _(validation.rs: missing_komi_rejected)_
- [x] Integer komi rejected (0, 1, -1) `[test: backend:integration]` _(validation.rs)_
- [x] Integer komi should be rejected via both web and API `[test: backend:integration]` _(validation.rs: komi must be half-integer)_

### Handicap

- [x] Handicap inputs of 0 or 1 are equivalent (no handicap; black plays first)
- [x] API should not accept negative handicap `[test: backend:integration]` _(validation.rs)_
- [x] API should accept handicaps greater than or equal to 0 `[test: backend:integration]` _(validation.rs: accept_handicap_one_as_no_handicap, accept_valid_handicap)_
- [x] API should not accept illegal handicap for board size `[test: backend:integration]` _(validation.rs)_
- [x] UI should skip 1 to avoid confusion: ie input skips from 0 to 2

### Time Control

- [ ] Timer should not appear to skip a second when starting periods (should round up) `[test: frontend:unit]`
- [ ] Restored time control choice in game form should correctly set radio input (shows time settings but "None" is selected)
- [x] Timer color must switch to red when low on time _(clock.ts: scaled emergMs threshold + SD always triggers low-time)_
- [ ] Timer format must switch to seconds.millis when t < 10s `[test: frontend:unit]`

### Visibility

- [x] Private game must only be visible to participants (challengee, or via invite token) `[test: backend:integration]` _(security.rs)_

### Invitations

- [ ] Invite by email: must send invite (needs local services to test)
- [ ] Invite link `/games/:id?token=...` must grant access to private game `[test: backend:integration]`
- [ ] Invite link must be required to join private games `[test: backend:integration]`
- [x] New game form allows invite by username (via user search) _(opponent fieldset with Open/Challenge/Invite modes, live search with presence, open_to restrictions)_

## 3. Game Lobby / Games List

- [ ] Pending outgoing challenges must appear in Challenges section; currently only visible for the challengee `[test: e2e:ws]`
- [ ] Games list order must be always be the same (ie, live updates insert in the right place) `[test: e2e:ws]`)

## 4. Joining Games

- [x] Cannot join private game without invite token `[test: backend:integration]` _(security.rs)_
- [x] Cannot join a game that is already finished/aborted `[test: backend:integration]` _(security.rs)_

## 5. Challenges

- [x] Declined status must show in GameStatus component `[test: frontend:unit]` _(game-status.tsx: getStatusText handles GameStage.Declined)_

## 6. Playing Moves

### Move Confirmation Mode

- [ ] Premove must be cleared on pass or turn change `[test: frontend:unit]`
- [x] "Confirm move" button should not shift layout
- [ ] Premove ghost must be cleared on pass or turn change `[test: frontend:unit]`
- [ ] Premove ghost must not trigger immediate move on turn change; premove context is only relevant during a player's turn `[test: frontend:unit]`

## 7. Passing

- [ ] Consecutive pass handling flaky; territory review phase can be lost on refresh `[test: e2e:ws]`

## 8. Resigning

- [ ] System chat message "Game over. {result}" must be broadcast on resign `[test: e2e:ws]`
- [x] Cannot resign before first move (backend guard); use abort instead `[test: backend:integration]` _(state_guards.rs)_
- [x] Resign button must be disabled before the first move is played _(capabilities.ts: canResign requires mvs.length > 0)_

## 9. Aborting

- [x] Only creator can abort pending challenge `[test: backend:integration]` _(security.rs)_
- [ ] "Game aborted" system chat message must include username ("Game aborted by $user") `[test: e2e:ws]`
- [x] Player should not be able to abort as soon as player reconnects (UI should immediately update) `[test: e2e:ws]` _(disconnect.rs: disconnect_abort_threshold + capabilities.test.ts: disconnect abort timing)_ **NOTE: significant frontend lag observed showing disconnected status updates — server-side thresholds are tested but UI responsiveness is not**

## 10. Undo / Takeback

### Requesting

- [ ] Undo button must be disabled with "Request pending" tooltip while outgoing request is pending `[test: e2e:ws]`
- [ ] Undo requested dialogue must be dismissed if own move played via API `[test: e2e:ws]`
- [ ] Undo button must be disabled after a pass `[test: frontend:unit]`
- [ ] Undo button must be re-enabled if state now allows undo request for player `[test: frontend:unit]`
- [ ] Undo button not visible in live-view on finished game

### Responding

- [ ] Both clocks must reset to time when undone move was played `[test: e2e:ws]`
- [x] Undo response must include clock data so frontend can sync clock display _(undo.rs: clock JSON added to undo_accepted/undo_rejected messages; messages.ts: syncClock called on undo)_

### Edge Cases

- [ ] Multiple rapid undo requests must be handled correctly (unclear how to test) `[test: backend:integration]`

## 11. Territory Review

### Entry

- [x] Moves/passes cannot be played during territory review (backend guard) `[test: backend:integration]` _(state_guards.rs)_
- [ ] Frontend must disable move input during territory review `[test: e2e:ws]`
- [x] Player stone icons in player panels must not change once set (currently reverts to BW icon in territory review) `[test: frontend:unit]` _(capabilities.ts: isNigiriPending excludes territory review)_
- [x] Player territory must be shown next to captures in player panels `[test: e2e:ws]`

### Dead Stone Toggling

- [x] Capture counts must be updated with dead stones in player panels `[test: e2e:ws]`

### Territory Approval

- [ ] System message must read: "Territory will be auto-confirmed in $TIME" `[test: e2e:ws]`
- [x] Cannot approve if already approved `[test: backend:integration]` _(state_guards.rs)_
- [ ] Clicking empty vertex (not a stone) during territory review must have no action (currently resets approval and countdown timer) `[test: e2e:ws]`
- [x] Move tree shows branch terminator node which shows territory highlight and final player scores
- [ ] Territory terminator node should only appear once (current bug exists where an extra terminator node is appended to the active node after initial game load)

### Scoring

- [ ] Dead stones counted as captures for opponent (not verified) `[test: backend:unit]`
- [ ] System chat message ("Game over. {result}") must be broadcast only once per game (currently duplicated) `[test: e2e:ws]`

## 12. Clock / Timer

### Byo-yomi

- [x] Last period shows as 'SD' (Sudden Death) with red styling _(clock.ts: period === 1 → " SD", always sets clockLow)_

### Correspondence

- [ ] There should not be any real-time countdown (async play)
- [ ] There should be real-time countdown in final hour

### Clock Pausing

- [x] Opponent clock pauses as soon as opponent disconnects `[test: e2e:ws]` _(disconnect.rs: clock_pauses_on_disconnect)_
- [x] Clock resumes when opponent reconnects `[test: e2e:ws]` _(disconnect.rs: reconnect_broadcasts_player_reconnected)_

### Clock Sync

- [x] No latency compensation in clock sync — `syncedAt` is set when the JS handler runs, not when the server serialized the message; on high-latency connections the opponent's displayed clock over-counts by the round-trip delta `[test: frontend:unit]` _(clock.rs: LagTracker quota system compensates network lag server-side; clock.ts: server_now_ms transit delay compensation client-side)_
- [ ] Client-side byoyomi period simulation can briefly diverge from server state (self-corrects on next server message) `[test: frontend:unit]`

### Edge Cases

- [ ] Very fast moves: increment must still be applied correctly (not tested) `[test: backend:unit]`
- [x] Disconnect during opponent's turn: their clock paused `[test: e2e:ws]` _(disconnect.rs: move_while_opponent_disconnected_keeps_clock_paused)_
- [ ] `timeoutFlagSent` race with reconnect: `syncClock` resets the flag unconditionally, so a near-simultaneous `state_sync` after sending a timeout flag could cause a duplicate `timeout_flag`; server handler must be idempotent `[test: e2e:ws]`
- [ ] Silent clock fallback on cache miss: if `ClockState::from_game` finds NULL clock columns on a timed game, it falls back to `ClockState::new`, silently resetting the clock `[test: backend:unit]`

## 13. Chat

- [x] Non-participants cannot chat in private games `[test: backend:integration]` _(security.rs)_

## 14. Move Navigation

### Keyboard

- [ ] Up arrow must jump to start (empty board) `[test: frontend:unit]`
- [ ] Down arrow must jump to last node in branch`[test: frontend:unit]`

### Button Controls

- [ ] Client must not crash when navigating after returning from chat or analysis tab (infinite recursion in live-game.tsx) `[test: e2e]`

### Move Tree

- [ ] Current position must be highlighted `[test: frontend:unit]`
- [ ] Active path must be highlighted `[test: frontend:unit]`
- [x] Branches must show final territory node with territories on settled games
- [ ] Container must auto-scroll to keep current node visible

## 15. Analysis Mode

### In-Game Analysis

- [ ] Analysis tree must be restored on refresh `[test: e2e]`
- [ ] Refreshing in-progress live game must always return to latest node on main branch. `[test: e2e]`
- [ ] Refreshing settled game must always return to last viewed node. `[test: e2e]`
- [ ] Move confirmation input must work in analysis mode `[test: e2e]`

### Standalone Analysis Page

- [ ] Player names must be editable (direct click-to-edit UX)

### Score Estimator

- [ ] Exit estimate must return to normal board view `[test: e2e]`
- [ ] Clicking "Accept" must end branch with final territory node (like accepting after double-pass)
- [ ] Clicking "Estimate score" button on a node which precedes an accepted estimate/territory simply moves to that node (bypass review flow)

### SGF Import

- [ ] Non-square board SGF must be rejected with error (untested) `[test: backend:unit, frontend:unit]`
- [ ] Unsupported board sizes must be rejected (untested) `[test: backend:unit, frontend:unit]`

### SGF Export

- [ ] Filename must be: "{YYYYMMDD}-{Black}-vs-{White}.sgf" live for games or analysis board with set player names; "analysis.sgf" for standalone without set names `[test: frontend:unit]`

## 16. Presentation Mode (Post-Game) — Currently Broken

- [ ] "Analyze" button on finished game must start presentation `[test: e2e:ws]`
- [ ] Must only be available on finished games `[test: e2e:ws]`
- [ ] Originator must enter analysis mode `[test: e2e:ws]`
- [x] All connected users must receive `presentation_started` `[test: e2e:ws]` _(presentation.rs: start_and_end_presentation)_
- [x] Presenter's board state must be broadcast to all viewers `[test: e2e:ws]` _(presentation.rs: presenter_sends_snapshots)_
- [x] Viewers must see real-time board updates as presenter navigates `[test: e2e:ws]` _(presentation.rs: presenter_sends_snapshots)_
- [ ] Move tree position must be synced for synced viewers `[test: e2e:ws]`
- [x] Originator must be able to give control to another user `[test: e2e:ws]` _(presentation.rs: give_control)_
- [x] Non-originator can request control `[test: e2e:ws]` _(presentation.rs: request_control)_
- [ ] Originator must see request popover with give/dismiss buttons
- [x] Control request can be cancelled `[test: e2e:ws]` _(presentation.rs: cancel_request)_
- [x] Control request can be rejected `[test: e2e:ws]` _(presentation.rs: reject_request)_
- [x] Only originator can `take_control` back `[test: e2e:ws]` _(presentation.rs: non_originator_cannot_take_control)_
- [ ] Delegated presenter exiting analysis must give control back to originator `[test: e2e:ws]`
- [ ] Viewers must be able to choose: follow presentation (default) or analyze locally `[test: e2e:ws]`
- [ ] Local analysis must not affect presentation `[test: e2e:ws]`
- [ ] Switching to local analysis must un-sync from presentation `[test: e2e:ws]`
- [ ] Exiting analysis must re-sync to ongoing presentation `[test: e2e:ws]`
- [x] Originator must exit analysis to end presentation `[test: e2e:ws]` _(presentation.rs: start_and_end_presentation)_
- [x] All viewers must receive `presentation_ended` `[test: e2e:ws]` _(presentation.rs: start_and_end_presentation)_
- [ ] Board must return to last game position for viewers `[test: e2e:ws]`

## 17. Rematch

- [ ] Rematch action must be available via both web and API (untested) `[test: backend:integration]`

## 18. UI / Display

### Player Panels

- [x] Opponent always in top panel (also for open games) `[test: frontend:unit]` _(capabilities.test.ts: player panel ordering)_

### Mobile / Responsive

- [ ] Board must resize dynamically when window is resized (both mobile and desktop layouts)
- [ ] Board must resize dynamically with surrounding UI shifts (layout shift incorrect when opponent joins; bottom label obscured)
- [ ] Move tree direction must adjust depending on container dimensions
- [ ] Layout should use available width when window height is small in mobile mode (stacked controls on one row)
- [x] Board must be centred when shrunk in short mobile layout

### Tab Title

- [x] Tab notification only enabled by receiving live move; not by changing tab or any other action `[test: e2e]`

## 19. Sound Effects

- [ ] Placing a stone manually must trigger sound in analysis

## 20. WebSocket Connection

- [ ] Pending messages must be queued and sent on reconnect (untested) `[test: e2e:ws]`
- [x] Online user list updated on connect/disconnect `[test: e2e:ws]` _(presence.rs: join_broadcasts_presence, disconnect_broadcasts_offline)_
- [ ] Multiple tabs must maintain separate connections `[test: e2e:ws]`
- [ ] Server restart must be handled gracefully `[test: e2e:ws]`
- [ ] Disconnected client must optimistically show played move if disconnected during player's turn
- [x] Presence indicators update immediately for all subscribers `[test: e2e:ws]` _(presence.rs: multiple_connections_no_false_offline)_
- [ ] No visual disconnection indicator for the local player — when WS closes, the clock keeps ticking and nothing tells the user they're offline; the 2s reconnect delay is invisible
- [ ] No `player_reconnected` broadcast after server restart — if the server restarts between disconnect and reconnect, in-memory disconnect tracking is lost; clock recovery from DB is correct but the opponent doesn't see the reconnection notification

## 21. REST API — Needs Thorough Automated Testing

### Public Endpoints

- [x] `GET /api/games` lists public games (no auth needed) `[test: backend:integration]` _(api.rs: list_games_returns_public_games, list_games_no_auth_required)_
- [x] `GET /api/games/:id` returns game state `[test: backend:integration]` _(api.rs: get_game_returns_game_state, get_game_no_auth_for_public_game)_
- [x] `GET /api/games/:id/messages` returns chat messages `[test: backend:integration]` _(api.rs: get_messages_returns_empty_initially, send_and_get_chat_messages)_
- [x] `GET /api/games/:id/turns` returns move history `[test: backend:integration]` _(api.rs: get_turns_returns_empty_initially, get_turns_after_moves)_
- [x] `GET /api/users/:username` returns user info `[test: backend:integration]` _(api.rs: get_user_returns_profile)_
- [x] `GET /api/users/:username/games` returns user's games `[test: backend:integration]` _(api.rs: get_user_games_returns_list)_

### Authenticated Endpoints

- [x] `POST /api/games` creates game `[test: backend:integration]` _(api.rs: create_game_via_api)_
- [x] `DELETE /api/games/:id` deletes unstarted game (creator only) `[test: backend:integration]` _(api.rs: delete_unstarted_game, delete_game_only_by_creator, delete_started_game_fails)_
- [x] `POST /api/games/:id/join` joins game `[test: backend:integration]` _(api.rs: join_game_via_api)_
- [x] `POST /api/games/:id/play` with `{col, row}` plays move `[test: backend:integration]` _(api.rs: play_move_via_api)_
- [x] `POST /api/games/:id/pass` passes `[test: backend:integration]` _(api.rs: pass_via_api)_
- [x] `POST /api/games/:id/resign` resigns `[test: backend:integration]` _(api.rs: resign_via_api)_
- [x] `POST /api/games/:id/abort` aborts `[test: backend:integration]` _(api.rs: abort_via_api)_
- [x] `POST /api/games/:id/undo` requests undo `[test: backend:integration]` _(api.rs: request_undo_via_api)_
- [x] `POST /api/games/:id/undo/respond` accepts/rejects undo `[test: backend:integration]` _(api.rs: respond_to_undo_via_api, respond_to_undo_reject)_
- [x] `POST /api/games/:id/territory/toggle` toggles dead chain `[test: backend:integration]` _(api.rs: toggle_chain_via_api, toggle_chain_outside_territory_review, toggle_resets_approval, non_player_cannot_toggle_chain, toggle_chain_requires_auth)_
- [x] `POST /api/games/:id/territory/approve` approves territory `[test: backend:integration]` _(api.rs: approve_territory_via_api, approve_territory_outside_territory_review, approve_territory_twice_returns_error, non_player_cannot_approve_territory, approve_territory_requires_auth)_
- [x] `POST /api/games/:id/accept` accepts challenge `[test: backend:integration]` _(api.rs: accept_challenge_via_api, accept_challenge_game_is_playable, creator_cannot_accept_own_challenge, non_participant_cannot_accept_challenge, cannot_accept_non_challenge_game, cannot_accept_already_accepted_challenge, cannot_accept_declined_challenge, accept_challenge_on_nonexistent_game_returns_404, accept_challenge_requires_auth)_
- [x] `POST /api/games/:id/decline` declines challenge `[test: backend:integration]` _(api.rs: decline_challenge_via_api, creator_cannot_decline_own_challenge, non_participant_cannot_decline_challenge, cannot_decline_non_challenge_game, cannot_decline_already_declined_challenge, decline_challenge_on_nonexistent_game_returns_404, decline_challenge_requires_auth)_
- [x] `POST /api/games/:id/rematch` creates rematch `[test: backend:integration]` _(api.rs: rematch_via_api, rematch_unfinished_game_fails)_
- [x] `POST /api/games/:id/messages` sends chat `[test: backend:integration]` _(api.rs: send_and_get_chat_messages)_
- [x] `GET /api/me` returns current authenticated user `[test: backend:integration]` _(api.rs: get_me_returns_current_user)_
- [x] Create endpoints should return 201 `[test: backend:integration]` _(api.rs: create_game_via_api)_

### Error Handling

- [x] 401 for missing/invalid token on authenticated endpoints `[test: backend:integration]` _(api.rs: missing_auth_returns_401, invalid_token_returns_401)_
- [x] 400 for invalid game actions (wrong turn, game over, etc.) `[test: backend:integration]` _(api.rs: wrong_turn_returns_error, non_player_cannot_play)_
- [ ] 422 for invalid data (wrong type) `[test: backend:integration]`
- [x] 404 for nonexistent game/user `[test: backend:integration]` _(api.rs: get_game_404_for_nonexistent, get_user_404_for_nonexistent, play_on_nonexistent_game_returns_404, etc.)_
- [x] JSON error responses with meaningful messages `[test: backend:integration]` _(api.rs: json_error_responses_have_error_field)_
- [ ] Error messages have inconsistent formatting `[test: backend:integration]`
- [ ] Error messages lack machine-readable error codes `[test: backend:integration]`

## 22. Cross-Cutting Edge Cases

- [ ] If Two players play simultaneously, server must be resilient against race conditions (needs automated test) `[test: backend:integration]`
- [x] Game with 0 komi disallowed (komi must be half-integer) `[test: backend:integration]` _(validation.rs)_
- [ ] Very long game (300+ moves): performance must be acceptable (untested) `[test: backend:integration]`
- [ ] Rapid-fire moves: server must handle correctly, no state corruption (needs automated test) `[test: backend:integration]`
- [ ] Network partition during move: move must be either fully applied or fully rolled back (needs automated test) `[test: backend:integration]`
- [x] DB transaction failure: engine state must be rolled back, no DB/cache divergence (needs automated test) `[test: backend:integration]` _(persist_clock now writes DB before updating in-memory cache)_
- [ ] Two anonymous users in same game, one registers mid-game (needs test): must be handled gracefully `[test: e2e:ws]`
