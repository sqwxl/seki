# Implementation Plans

## 1. Lag Compensation (Lichess Quota System) — DONE

### Overview

Adopt Lichess's quota-based lag compensation to prevent high-latency players from being unfairly penalized. The server measures network overhead per move and credits back a portion, bounded by a regenerating quota.

### How It Works

Each player maintains a `LagTracker` with:
- `quota`: current compensatable budget (centiseconds)
- `quota_gain`: amount regenerated per move
- `quota_max`: ceiling on banked quota

Per move:
1. Server measures `elapsed = now - clock_last_move_at`
2. Client sends `client_move_time` (thinking time) with the move
3. Server computes `lag = elapsed - client_move_time`
4. `comp = min(lag, quota)` — compensate up to available quota
5. `move_time = elapsed - comp` — only the remainder is charged
6. `quota = min(quota + quota_gain - comp, quota_max)`

### Key Constants (from Lichess)

```
quota_gain = min(100cs, total_est_seconds * 2 / 5 + 15cs)
initial quota = quota_gain * 3
quota_max = quota_gain * 7
estimated_cpu_lag = 14cs (baseline added to frame lag)
lag recording cap = 2000cs (20 seconds)
flag grace = min(quota, 200cs)
```

For a 30-minute game (~1800s estimated): `quota_gain = min(100, 735) = 100cs` (1 second).
For a 5-minute game (~300s estimated): `quota_gain = min(100, 135) = 100cs`.
For a 1-minute game (~40s estimated): `quota_gain = min(100, 31) = 31cs`.

### Implementation Concerns

- **`MoveMetrics` from client**: The client must send its own measured thinking time with each move. Add a `client_move_time_ms` field to the play/pass WS messages. The server uses this alongside its own elapsed measurement to isolate network lag.
- **Server-side only**: All compensation happens server-side. The client never adjusts its own clock — it just displays what the server sends. This prevents exploitation.
- **Flag grace**: When checking `is_flagged()`, subtract `min(quota, 200cs)` from elapsed before comparing to remaining time. This prevents flagging during lag spikes.
- **`server_now` field**: Include a `server_now` timestamp in clock JSON so the client can compute transit delay: `display_remaining = remaining - (Date.now() - server_now)`. This is the simplest client-side improvement and can be done independently.
- **Quota per player**: Each player's `LagTracker` is independent. Store in the `GameRoom` alongside `ClockState`.
- **Persistence**: Quota state does NOT need to be persisted to DB. It resets on server restart (same as Lichess). Only `ClockState` (remaining time) is persisted.

### Files to Modify

- `seki-web/src/services/clock.rs` — Add `LagTracker` struct and `on_move()` method
- `seki-web/src/services/game_actions/mod.rs` — Pass `MoveMetrics` through `process_clock_after_move`
- `seki-web/src/ws/game_channel.rs` — Parse `client_move_time_ms` from play/pass messages
- `seki-web/src/ws/registry.rs` — Store per-player `LagTracker` in `GameRoom`
- `seki-web/src/services/state_serializer.rs` — Add `server_now` to clock JSON
- `seki-web/frontend/src/game/clock.ts` — Use `server_now` for transit delay compensation
- `seki-web/frontend/src/game/channel.ts` — Send `client_move_time_ms` with moves

### References

- [Lichess `LagTracker.scala`](https://github.com/lichess-org/scalachess/blob/master/core/src/main/scala/LagTracker.scala)
- [Lichess `Clock.scala` — `step()` method](https://github.com/lichess-org/scalachess/blob/master/core/src/main/scala/Clock.scala)
- [Lichess `MoveMetrics.scala`](https://github.com/lichess-org/scalachess/blob/master/core/src/main/scala/MoveMetrics.scala)
- [Lichess GitHub issue #12097](https://github.com/lichess-org/lila/issues/12097) — Discussion on quota gain formula
- [ACM Survey: Latency Compensation Techniques](https://dl.acm.org/doi/10.1145/3519023)

---

## 2. Clock Keeps Running + Claim Victory Flow — DONE

### Overview

Replace the current "pause clock on disconnect" behavior with the FIDE-standard approach: clocks keep running during disconnection. The opponent gets a "claim victory" button after a variable grace period.

### Grace Period Formula (from Lichess)

```
base_timeout = 30 seconds

speed_multiplier:
  correspondence: 30 days (effectively infinite)
  classical (>= 30 min): 10x = 300s
  rapid (10-30 min): 4x = 120s
  blitz (3-10 min): 2x = 60s
  bullet (< 3 min): 1x = 30s

timeout = base_timeout * speed_multiplier / material_divisor / user_divisor * gone_weight
minimum = ragequit_timeout (10 seconds)
```

For Go, there is no material imbalance concept, so skip the material divisor. The user divisor (anonymous = 2x faster claim) and `gone_weight` (habitual quitter penalty, see plan #4) still apply.

### Ragequit Detection

Lichess distinguishes intentional leave from connection loss:
- **Intentional leave** (`bye` flag): Player navigates away or closes tab. Detected via `beforeunload` event or explicit WS close. Grace period drops to 10 seconds.
- **Connection loss**: Detected by ping timeout. Full grace period applies.

Implementation: add a `bye` WS message type. The client sends it on `beforeunload`. The server stores a `bye: bool` on the player's disconnect state.

### Frontend UX

1. **First 5 seconds**: No indication (absorbs brief network hiccups)
2. **After 5 seconds**: Show "Opponent left. They have Xs to reconnect." with countdown (tick in 5s intervals)
3. **After grace period expires**: Show "Claim Victory" and "Claim Draw" buttons
4. **Own disconnection**: Show a "Reconnecting..." banner immediately when WS closes

### Implementation Concerns

- **Remove clock pause on disconnect**: In `handle_disconnect` (live.rs), stop calling `clock.pause()`. Instead just mark the player as disconnected and broadcast a `player_disconnected` message with the grace period duration.
- **Server-side "gone" timer**: After the grace period, broadcast `player_gone` (distinct from `player_disconnected`). The client shows claim buttons only after `player_gone`.
- **Claim victory action**: New WS action `claim_victory` / `claim_draw`. Server validates that the opponent is truly gone (past grace period) and the game is still active. Ends the game as resignation or draw.
- **Clock expiry still works independently**: If the disconnected player's clock runs out, normal flagging applies regardless of the grace period. The claim flow is for when the clock hasn't expired yet but the player is clearly gone.
- **Reconnection cancels "gone"**: If the player reconnects before the grace period expires, broadcast `player_reconnected` and cancel the countdown. If they reconnect after `player_gone` but before a claim, the claim buttons disappear.
- **Both players disconnect**: Both clocks run. If one expires, the sweep flags it normally. No special handling needed.

### Files to Modify

- `seki-web/src/ws/live.rs` — Remove clock pause in `handle_disconnect`, add grace period timer, add `bye` handling, add `player_gone` broadcast
- `seki-web/src/ws/registry.rs` — Store `bye` flag and grace period expiry per disconnected player
- `seki-web/src/ws/game_channel.rs` — Handle `claim_victory` / `claim_draw` actions
- `seki-web/src/services/game_actions/mod.rs` — Add `claim_victory` / `claim_draw` actions
- `seki-web/src/ws/presence.rs` — Potentially adjust grace period logic
- `seki-web/frontend/src/ws.ts` — Send `bye` on `beforeunload`
- `seki-web/frontend/src/game/messages.ts` — Handle `player_gone` message, show countdown
- `seki-web/frontend/src/game/state.ts` — Add `opponentGone` signal (distinct from `opponentDisconnected`)
- `seki-web/frontend/src/game/capabilities.ts` — Add `canClaimVictory` / `canClaimDraw` controls
- `seki-web/frontend/src/components/player-panel.tsx` — Show reconnect countdown / claim buttons

### References

- [Lichess `RoundSocket.scala` — timeout constants](https://github.com/lichess-org/lila/blob/master/modules/round/src/main/RoundSocket.scala)
- [Lichess `RoundAsyncActor.scala` — Player disconnect tracking](https://github.com/lichess-org/lila/blob/master/modules/round/src/main/RoundAsyncActor.scala)
- [FIDE Online Chess Regulations](https://handbook.fide.com/chapter/OnlineChessRegulations)
- [Chess.com lag forgiveness FAQ](https://support.chess.com/en/articles/8615369-what-is-lag-forgiveness-why-did-the-clocks-suddenly-change)

---

## 3. Clock Display Improvements — DONE

### Overview

Improve clock formatting to handle long time controls, byoyomi states, and low-time display.

### Changes

**Time > 1 hour** (OGS format):
- `>= 24h`: `"Xd Yh"` (e.g., "2d 5h")
- `>= 1h`: `"Xh Ym"` (e.g., "1h 23m")
- This replaces the current correspondence format which only shows `Xd Xh` / `Xh Xm`.

**Byoyomi periods** (OGS format):
- During main time: show `"MM:SS"` or `"SS.t"` as normal, no period indicator
- In overtime with >1 period: show `"MM:SS (N)"` where N is periods remaining
- In overtime with 1 period: show `"MM:SS SD"` (Sudden Death) with red styling
- The `SD` label clearly communicates the stakes of the last period

**Low-time threshold** (Lichess approach):
- `emerg_seconds = max(10, limit_seconds / 8)` — scales with time control
- Currently hardcoded to 10s. For a 60-minute game, this would be 450s (7.5 min), which is too generous. Cap at something reasonable like `min(60, max(10, limit_seconds / 8))`.

### Files to Modify

- `seki-web/frontend/src/game/clock.ts` — `formatClock()` and `computeClockDisplay()`
- `seki-web/frontend/src/components/player-panel.tsx` — CSS class for SD state
- `seki-web/frontend/src/game/types.ts` — Possibly extend `ClockData` if server needs to send main time vs overtime distinction

### References

- [OGS `Clock.tsx`](https://github.com/online-go/online-go.com/blob/main/src/components/Clock/Clock.tsx)

---

## 4. Disconnection Abuse Mitigation (Habitual Quitter Penalty)

### Overview

Track per-user disconnection behavior across games. Players who repeatedly disconnect in losing positions get reduced grace periods, making it easier for opponents to claim victory.

### Lichess "Rage Sit" System

Lichess maintains a per-user counter that increments when a player disconnects and loses, and decrements when they play normally. The counter feeds into a `gone_weight` multiplier:

```
gone_weight = (1 - 0.7 * sqrt(log10(-counter - 3))).max(0.1)
```

This means:
- Normal players: `gone_weight = 1.0` (full grace period)
- Moderate offenders: `gone_weight ~ 0.5` (half grace period)
- Habitual quitters: `gone_weight ~ 0.1` (10% grace period, floor)

The multiplied timeout is floored at `ragequit_timeout` (10 seconds).

### Implementation Concerns

- **New DB column**: Add `disconnect_score` (integer) to `users` table. Start at 0. Negative values indicate habitual quitting.
- **Score updates**: After each game ends:
  - Player disconnected and lost → decrement by 1
  - Player completed game normally → increment by 1 (cap at 0, never positive)
  - Player disconnected and won → no change (winning while disconnected is fine)
- **Score decay**: Periodically (daily cron or on login) move the score toward 0 by 1 point. This allows rehabilitation.
- **gone_weight calculation**: `(1.0 - 0.7 * (((-score) as f64 - 3.0).log10().sqrt())).max(0.1)` — only kicks in when score < -3, so occasional disconnects are not penalized.
- **Migration**: New migration adds `disconnect_score INTEGER NOT NULL DEFAULT 0` to `users`.
- **Anonymous users**: Apply a default `gone_weight` of 0.5 (like Lichess's anonymous divisor). Anonymous users cannot build a reputation, so they get a shorter baseline.

### Files to Modify

- `seki-web/migrations/NNN_add_disconnect_score.sql` — New column
- `seki-web/src/models/user.rs` — Add `disconnect_score` field, update/query methods
- `seki-web/src/ws/live.rs` — Load `disconnect_score` when computing grace period
- `seki-web/src/services/game_actions/mod.rs` — Update score on game end
- `seki-web/src/ws/registry.rs` — Store computed `gone_weight` per player in room

### References

- [Lichess `RoundAsyncActor.scala` — `goneWeight` usage](https://github.com/lichess-org/lila/blob/master/modules/round/src/main/RoundAsyncActor.scala)
- [Lichess `RoundSocket.scala` — timeout formula](https://github.com/lichess-org/lila/blob/master/modules/round/src/main/RoundSocket.scala)

---

## 5. Anti-Stalling in Territory Review (KataGo)

### Overview

Prevent stalling during territory review by using KataGo to evaluate the position. If a player passes 3 consecutive times and KataGo is highly confident in the outcome, both players get an "end game" button.

### OGS Approach

- **Activation threshold**: At least `board_area / 3` moves played (~120 on 19×19)
- **Trigger**: Player passes 3 times consecutively during territory review
- **Evaluation**: Server asks KataGo for a win probability and score estimate
- **Resolution**: If KataGo is >99% confident one side wins by >10 points, both players see an "end game" option that settles with KataGo's score
- **Pass counter persistence**: The 3-pass counter persists through scoring phase resumptions (prevents reset exploitation)

### Implementation Concerns

- **KataGo integration**: Run KataGo as a sidecar process or connect via GTP (Go Text Protocol). KataGo supports analysis mode where you send a position and get back win rate + score estimate.
- **GTP interface**: Send `kata-analyze` command with the current board state. Parse the response for `winrate` and `scoreLead` fields.
- **Performance**: KataGo analysis is fast (~100ms on modern hardware for a single position). Run it asynchronously — the territory review flow already has a timeout mechanism.
- **Fallback**: If KataGo is unavailable (not installed, crashed), fall back to the existing territory review timeout. The anti-stalling feature is an enhancement, not a requirement.
- **Configuration**: KataGo binary path and model file path as environment variables (`KATAGO_PATH`, `KATAGO_MODEL`). Disabled when not configured.
- **Scope**: Only applies during territory review, not during normal play. The trigger is consecutive passes during review, not consecutive passes that enter review (those are already handled by the double-pass rule).
- **"End game" vs auto-settle**: OGS gives both players a choice rather than auto-settling. This is important — KataGo can be wrong about seki or complex life-and-death. The button says something like "KataGo estimates B+12.5 — accept this result?" and either player can decline.
- **Resource management**: Start KataGo process on demand (first territory review that needs it) and keep it alive for subsequent queries. Kill after idle timeout (e.g., 5 minutes).

### Files to Create/Modify

- `seki-web/src/services/katago.rs` — New module: KataGo GTP client, position serialization, response parsing
- `seki-web/src/services/game_actions/territory.rs` — Add pass counting, trigger KataGo evaluation, broadcast result
- `seki-web/src/ws/game_channel.rs` — Handle `accept_katago_result` action
- `seki-web/frontend/src/game/messages.ts` — Handle `katago_result` message
- `seki-web/frontend/src/game/state.ts` — Add `katagoResult` signal
- `seki-web/frontend/src/game/capabilities.ts` — Add `canAcceptKatagoResult` control

### References

- [KataGo GTP documentation](https://github.com/lightvector/KataGo/blob/master/docs/GTP_Extensions.md)
- [KataGo analysis engine](https://github.com/lightvector/KataGo)
- [OGS anti-stalling forum thread](https://forums.online-go.com/t/anti-escaping-and-anti-stalling-features/49174)
- [OGS anti-stalling amendment discussion](https://forums.online-go.com/t/amending-the-anti-stalling-feature/51906)

---

## Implementation Order

1. ~~**Clock Display Improvements** (plan 3)~~ — **DONE**: `Xh Ym` for ≥1h, `SD` for last byoyomi period, scaled low-time threshold
2. ~~**Lag Compensation** (plan 1)~~ — **DONE**: LagTracker quota system, server_now_ms transit compensation, client_move_time_ms, flag grace
3. ~~**Clock Keeps Running + Claim Victory** (plan 2)~~ — **DONE**: disconnect grace timer, `bye`, `player_disconnected`/`player_gone`/`player_reconnected`, claim-victory flow
4. **Disconnection Abuse Mitigation** (plan 4) — Builds on the existing grace period system
5. **KataGo Anti-Stalling** (plan 5) — Independent feature, requires external dependency
