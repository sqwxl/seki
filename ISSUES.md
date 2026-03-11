# Issues

## 0. Misc

## 1. Auth & Sessions

## 2. Game Creation

### Time Control


### Invitations

- Private games must be accessible to anyone with the invite link (token) (currently blocks anyone after player slots filled with 'Game is already full' error) `[test: backend:integration]`

## 3. Game Lobby / Games List

- Pending outgoing challenges must appear in Challenges section for both challenger and challengee. `[test: e2e:ws]`
- Games list order must be always be the same (ie, live updates insert in the right place) `[test: e2e:ws]`)
- Lobby/Game info popovers must include the following items (can include more depending on context):
  - Board dimensions
  - Komi
  - Handicap
  - Time control
  - Rules (not yet implemented)
  - Rated?
  - Takebacks?
  - Private?
  - Black ('?' for unknown or random)
  - White ('?' for unknown or random)

## 4. Joining Games (as player)

## 5. Challenges

## 6. Playing Moves


### Move Confirmation Mode


## 7. Passing

## 8. Resigning

## 9. Aborting

## 10. Undo / Takeback

### Requesting


### Responding

### Edge Cases

## 11. Territory Review

### Entry

- **Bug:** Client must not be able to trigger a new territory review on a finished game by clicking the move count button `[test: e2e:ws]` <!-- possibly stale: server already guards against this, frontend state needs verification -->

### Dead Stone Toggling

### Territory Approval

- Game status component must show contextual territory phase messages: "Territory review; select dead stones; accept when ready" and "Opponent accepted. {secs}s" `[test: frontend:unit]`

### Scoring

- Dead stones counted as captures for opponent (not verified) `[test: backend:unit]`

## 12. Clock / Timer

### Correspondence

- There should not be any real-time countdown (async play)
- There should be real-time countdown in final hour

### Disconnect / Claim Victory

- Both players disconnect simultaneously: game should end by clock timeout with no one to claim `[test: e2e:ws]`
- Grace period scaling: halve grace period if disconnected player is losing badly (score/capture differential) `[test: e2e:ws]`
- RageSit scoring: repeat disconnect offenders get shorter grace periods (requires per-user disconnect history) `[test: e2e:ws]`
- Anonymous user penalty: halve disconnect grace period for unregistered users `[test: e2e:ws]`

### Clock Sync

- Client-side byoyomi period simulation can briefly diverge from server state (self-corrects on next server message) `[test: frontend:unit]`

### Edge Cases

- Very fast moves: increment must still be applied correctly (not tested) `[test: backend:unit]`
- Silent clock fallback on cache miss: if `ClockState::from_game` finds NULL clock columns on a timed game, it falls back to `ClockState::new`, silently resetting the clock `[test: backend:unit]`

## 13. Chat

## 14. Move Navigation

### Button Controls

### Move Tree

## 15. Analysis Mode

### In-Game Analysis

- Analysis tree must be restored on refresh `[test: e2e]`
- Refreshing in-progress live game must always return to latest node on main branch. `[test: e2e]`
- Refreshing settled game must always return to last viewed node. `[test: e2e]`
- Move confirmation input must work in analysis mode `[test: e2e]`

### Standalone Analysis Page

- Player names must be editable (direct click-to-edit UX)

### Score Estimator

- Exit estimate must return to normal board view `[test: e2e]`
- Clicking "Estimate score" button on a node which precedes an accepted estimate/territory simply moves to that node (bypass review flow)

### SGF Import

- Non-square board SGF must be rejected with error (frontend validates, backend untested) `[test: backend:unit]`
- Unsupported board sizes must be rejected (frontend validates, backend untested) `[test: backend:unit]`

### SGF Export

## 16. Presentation Mode (Post-Game)

- "Analyze" button on finished game must start presentation `[test: e2e:ws]`
- Originator must enter analysis mode `[test: e2e:ws]`
- Move tree position must be synced for synced viewers `[test: e2e:ws]` — requires move tree component to consume activeNodeId from snapshot
- Originator must see request popover with give/dismiss buttons
- Delegated presenter exiting analysis must give control back to originator `[test: e2e:ws]`
- Viewers must be able to choose: follow presentation (default) or analyze locally `[test: e2e:ws]`
- Local analysis must not affect presentation `[test: e2e:ws]`
- Switching to local analysis must un-sync from presentation `[test: e2e:ws]`
- Exiting analysis must re-sync to ongoing presentation `[test: e2e:ws]`

## 17. Rematch

- Rematch action must be available via both web and API (untested) `[test: backend:integration]`

## 18. UI / Display

- Popovers should not obscure global nav bar.

### Mobile / Responsive

- Board must resize dynamically when window is resized (both mobile and desktop layouts)
- Board must resize dynamically with surrounding UI shifts (layout shift incorrect when opponent joins; bottom label obscured)
- Move tree direction must adjust depending on container dimensions
- Layout should use available width when window height is small in mobile mode (stacked controls on one row)

### Tab Title

## 19. Sound Effects

## 20. WebSocket Connection

- Pending messages must be queued and sent on reconnect (untested) `[test: e2e:ws]`
- Multiple tabs must maintain separate connections `[test: e2e:ws]`
- Server restart must be handled gracefully `[test: e2e:ws]`
- Disconnected client must optimistically show played move if disconnected during player's turn
- Opponent disconnected message must use consistent UI (currently poor/inconsistent presentation) `[test: frontend:unit]`
- No visual disconnection indicator for the local player — when WS closes, the clock keeps ticking and nothing tells the user they're offline; the 2s reconnect delay is invisible
- No `player_reconnected` broadcast after server restart — if the server restarts between disconnect and reconnect, in-memory disconnect tracking is lost; clock recovery from DB is correct but the opponent doesn't see the reconnection notification

## 21. REST API — Needs Thorough Automated Testing

### Error Handling

- 422 for invalid data (wrong type) `[test: backend:integration]`
- Error messages have inconsistent formatting `[test: backend:integration]`
- Error messages lack machine-readable error codes `[test: backend:integration]`

## 22. Cross-Cutting Edge Cases

- If Two players play simultaneously, server must be resilient against race conditions (needs automated test) `[test: backend:integration]`
- Very long game (300+ moves): performance must be acceptable (untested) `[test: backend:integration]`
- Rapid-fire moves: server must handle correctly, no state corruption (needs automated test) `[test: backend:integration]`
- Network partition during move: move must be either fully applied or fully rolled back (needs automated test) `[test: backend:integration]`
- Two anonymous users in same game, one registers mid-game (needs test): must be handled gracefully `[test: e2e:ws]`
