# seki-api migration — making seki-api the wire contract

Goal: seki-api becomes the single source of truth for the WS wire protocol.
seki-web serializes every outgoing message through `ServerMsg` and
deserializes every incoming message through `ClientMsg`. No more hand-rolled
`json!` or `data.get("action")` string matching on the server.

Status: step 3 done (territory/pregame wire types ported). This plan covers
step 4, the largest chunk.

## Surface inventory

### Incoming (2 parse sites, ~29 actions)

- `ws/live.rs:139` — connection-level: `bye`, `ping`, `join_game`, `subscribe_presence`.
- `ws/game_channel.rs:154` — game-level: `play`, `pass`, `resign`,
  `accept_challenge`, `decline_challenge`, `abort`, `chat`, `request_undo`,
  `respond_to_undo`, `toggle_chain`, `approve_territory`,
  `update_pregame_settings`, `accept_pregame_settings`,
  `reject_pregame_settings`, `claim_victory`, `timeout_flag`,
  `territory_timeout_flag`, `start_presentation`, `end_presentation`,
  `presentation_state`, `give_control`, `take_control`, `request_control`,
  `cancel_control_request`, `reject_control_request`.

### Outgoing (38 `"kind"` emit sites across 9 files)

| File | Kinds |
|---|---|
| `services/state_serializer.rs` | `state` (1) |
| `ws/game_channel.rs` | `error`×4, `control_changed`, `presentation_started`, `undo_request_sent`, `undo_response_needed` (8) |
| `ws/live.rs` | `init`, `player_disconnected`, `player_gone`, `player_reconnected`, `error`×2, `pong` (7) |
| `services/live.rs` | `game_created`, `game_updated`, `game_removed` (3) |
| `services/presentation_actions.rs` | `presentation_started`, `presentation_update`, `presentation_ended`×3, `control_changed`×3, `control_requested`, `control_request_cancelled`×2 (11) |
| `services/game_actions/undo.rs` | `undo_request_sent`, `undo_response_needed`, `undo_accepted`/`undo_rejected` (4) |
| `services/game_actions/chat.rs` + `mod.rs` | `chat`×2 (2) |
| `ws/presence_subscriptions.rs` | `presence_changed`, `presence_state` (2) |

## Structural change 1 — `ClientMsg` → tagged action enum

Today: `{ action: String, game_id, #[serde(flatten)] payload: ClientPayload }`
with an untagged payload enum covering only ~10 actions plus `Empty`. The free
`action` string exists because the enum is incomplete.

Target: `#[serde(tag = "action", rename_all = "snake_case")]` enum, one
variant per action, payload coupled to action so action↔payload disagreement
is impossible. Frontend already sends action-keyed JSON, so its wire format is
unchanged.

## Structural change 2 — `ServerMsg` adoption at emit sites

Each `json!({...})` becomes `serde_json::to_value(&ServerMsg::X { ... })`.
`state` (serialize_state) is the largest single site.

## Known drift to fix en route

1. `ServerMsg::Chat { game_id }` — server broadcasts full content
   (`id`, `user_data`, `client_message_id`, `text`, `move_number`, `sent_at`).
   Enum must gain those fields.
2. `ServerMsg::UndoRejected { game_id }` — server emits the full body
   (state, moves, current_turn_stone, undo_rejected, clock), identical to
   `UndoAccepted` (shared build path). Enum must gain those fields.
3. `requesting_player` — server and enum agree; frontend TS says
   `requesting_user` (stale). Verify what `messages.ts` reads, fix the stale side.
4. `pong`, `bye`, `ping`, `subscribe_presence` — connection-level, absent
   from the enums. Decision: include them (total contract).

## Ordering

1. Tighten `ClientMsg` (incoming): rewrite constructor helpers, point
   `live.rs`/`game_channel.rs` at `serde_json::from_str::<ClientMsg>` + enum
   match. Bots compile against the new enum.
2. `ServerMsg` adoption by domain (outgoing): presence/lobby → game actions →
   presentation → `state`. Each chunk gated on the 233 integration tests.

## Test strategy

- 233 seki-web integration tests (primary net; assert exact kinds + some fields).
- seki-api `deser_test.rs` round-trips for tightened `ClientMsg` + fixed
  `Chat`/`UndoRejected` variants.
- `cargo check --all` (bots consume `ClientMsg` helpers + `ServerMsg` variants).
- Frontend: no wire change needed; fix `game/types.ts` drift opportunistically.

## Decision points

1. Connection-level messages in the enums? — yes, total contract.
2. `PresenceState.users: HashMap<String,bool>` — nondeterministic key order;
   acceptable (keys are ids), revisit if tests complain.
3. `ClientMsg` constructor helpers — keep as thin helpers on the new enum
   (bots use them 20+ times).

## Risks

~30 files. Do it in sub-PRs (incoming, then outgoing by domain) with the
integration suite as the gate.
