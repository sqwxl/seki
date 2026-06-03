# 06 — Random Playout MCTS Engine PoC

## Goal

Add a local bot search path that can choose legal moves using Monte Carlo search.
Start with random playouts as the evaluator, but keep the search core generic so
NN policy/value output can replace random move selection without rewriting MCTS.

This bot will be weaker than NN-guided MCTS. The target is useful practice on
small boards, especially 9x9, with simple code that can later accept NN policy
and value guidance.

## Inputs

- Existing `go-engine` rules, legal move checks, pass handling, and scoring.
- Existing random playout implementation in `go-engine/src/territory`.
- KataGo graph-search note, target algorithm constraints:
  `https://github.com/lightvector/KataGo/blob/master/docs/GraphSearch.md#doing-monte-carlo-graph-search-correctly`

## Scope

Build in `go-engine` first. Expose through WASM only after the core search is
deterministic, tested, and reasonably fast.

Architecture direction:

- Implement MCTS core in Rust/WASM, not TypeScript.
- Keep TypeScript as worker orchestration for model loading, batching, progress,
  cancellation, and UI messages.
- Keep legal move generation and graph search close to `go-engine` rules to
  avoid duplicating Go legality in JS.
- Start single-threaded. Browser WASM threads require cross-origin isolation
  (`SharedArrayBuffer`), and the current PoC environment is not isolated.
- Optimize model-eval count and batching before adding threading; current mobile
  NN eval latency dominates MCTS loop overhead.

Frontend PoC exception: the browser inference harness may host a tiny temporary
policy-backed search loop to validate that model policy/value output can drive
move selection before the Rust engine MCTS exists. Keep that code isolated from
product UI and do not treat it as legal Go search.

In scope:

- Legal move generation, including pass.
- Random rollout evaluation behind a pluggable policy/value interface.
- Small tree MCTS scaffold only if useful for tests.
- Graph MCTS following KataGo's parent-edge/action-stat guidance.
- Deterministic search seeds for tests.
- Small-board performance checks.
- NN policy/value adapter shape, without requiring a model in this phase.
- Edge/action statistics as first-class search state.

Out of scope:

- Neural-network policy/value evaluation.
- Pondering.
- Product bot UI.
- Server-side bot games.
- Ranked play.
- Advanced life-and-death solver.

## Frontend Policy-MCTS Probe

Current implementation:

- `seki-web/frontend/src/ai-poc/mcts.ts` contains a small async PUCT tree search.
- The AI PoC worker accepts `type: "search"` requests.
- Search loads one ONNX session, evaluates leaf positions with model
  policy/value, and returns best move plus root visit stats.
- `/static/ai-poc.html` has a `Run policy MCTS` button with visit and max-child
  controls.

Known limits:

- Legal move generation is temporary: empty intersections plus pass only.
- Captures, suicide, ko, superko, pass-ending, and scoring are not implemented.
- Positions use the PoC feature-encoder shape, not live Seki engine snapshots.
- This is a feasibility bridge from NN output to search. Production move
  generation still belongs in `go-engine`.

Chrome Android WebGPU timing from 2026-06-03:

- `lionffen-b6c64-19x19`, empty 19x19 position, warm tab.
- 24 visits / 32 max children: 5,128.8 ms, best move `D3`.
- 48 visits / 96 max children: 10,711.4 ms, best move `D3`.
- Search time scales roughly linearly with leaf evaluations. Current PoC is
  useful for proving the NN-to-search bridge, but too slow for interactive
  high-visit MCTS without batching, caching, or fewer model evals.

## Core Design

Add a small search module under `go-engine`, for example `mcts/`.

Separate search from evaluation:

- **Search core:** graph traversal, visit counts, action selection, backup.
- **Evaluator:** supplies priors and leaf values for a position.
- **Rollout evaluator:** v1 implementation using random playouts.
- **NN evaluator:** future implementation using model policy/value output.

Keep the public API compact:

```rust
pub struct MctsConfig {
    pub visits: u32,
    pub rollout_limit: u32,
    pub seed: u64,
}

pub enum BotMove {
    Play(Point),
    Pass,
}

pub fn genmove(engine: &Engine, config: MctsConfig) -> BotMove;
```

The search owns no global state. Given the same position, config, and seed, it
should return the same move.

Internally, use an evaluator trait or equivalent small interface:

```rust
pub struct ActionPrior {
    pub action: BotMove,
    pub prior: f32,
}

pub struct Evaluation {
    pub value: f32,
    pub priors: Vec<ActionPrior>,
}

pub trait MctsEvaluator {
    fn evaluate(&mut self, engine: &Engine, to_play: Stone) -> Evaluation;
}
```

`value` is from `to_play`'s perspective. Random rollout computes it by playing to
the end and scoring. NN evaluation later maps model policy logits to `priors`
and model value output to `value`.

## Phase 1 — Search/Evaluator Boundary

Define the action and evaluation types before implementing search. This keeps
MCTS independent from whether leaf values come from random rollouts or neural
network inference.

Rules:

- MCTS consumes priors and value only through the evaluator interface.
- MCTS never reaches into NN-specific tensor shapes.
- MCTS never assumes rollout randomness exists.
- Evaluators never mutate the visible game; they work on cloned `Engine`
  positions.

For random playouts:

- Priors are uniform over legal actions.
- Value comes from random rollout score.
- Current Rust status: `go-engine::mcts` has action/evaluation types,
  `legal_actions`, `uniform_priors`, `apply_action`, deterministic PRNG, and
  `RandomRolloutEvaluator`.

For NN later:

- Priors come from policy output after legal-move masking and softmax.
- Value comes from value head.
- Rollouts can be disabled, or used only as a fallback if value is unavailable.

## Phase 2 — Shared Playout Primitives

Extract or duplicate only the minimal useful pieces from
`territory/dead_stones.rs`.

Do not reuse that code directly if it makes bot search harder to reason about.
It is tuned for dead-stone detection, not move selection.

Needed primitives:

- Tiny deterministic PRNG.
- Legal move list from `Goban` or `Engine`.
- Apply move or pass to a cloned `Engine`.
- Detect terminal rollout state:
  - two consecutive passes,
  - no playable moves,
  - rollout depth limit.
- Score final position from the bot player's perspective.

Rollout evaluator v1:

- Pick uniformly from legal moves plus pass.
- Avoid obvious self-atari/eye-fill only if this is cheap and local.
- End on two passes.
- Return uniform priors for the root/leaf legal actions.
- Return scored rollout value for the leaf position.

## Phase 3 — Tree MCTS Baseline

Implement only enough tree MCTS to validate evaluator boundaries and backup math.
This phase is allowed to be short-lived. The production target is graph search
using the KataGo GraphSearch guidance.

Node state:

- Position snapshot or move path from root.
- Side to move.
- Child actions.
- Visit count.
- Total value from the node player's perspective.

Selection:

- Use PUCT-style exploration with priors from the evaluator.
- Select child by exploration-adjusted value.

Expansion:

- Generate legal actions once.
- Include pass.
- Add one or all children; choose the simpler implementation first.

Evaluation:

- Call evaluator for the leaf.
- Random evaluator runs a rollout and scores black/white result.
- NN evaluator later returns policy/value directly.
- Convert result to value for each player during backup.

Backup:

- Alternate perspective by ply.
- Keep value math explicit and tested.

Final move:

- Pick the root action with the highest visit count.
- Use value only as a tie-breaker.

Exit criteria:

- Evaluator boundary compiles and is tested.
- Backup perspective math is tested.
- Legal action generation is tested.
- No product/WASM API depends on tree-only internals.

## Phase 4 — KataGo-Style Graph Search

Implement the real MCTS core as graph search, not just tree search with a cache.

Follow the KataGo graph-search warning: parent action statistics are not the
same as child node statistics. Track edge/action visits separately from node
visits.

Required graph state:

- Position key.
- Node visits/value for shared position-level information.
- Per-parent action stats:
  - action,
  - child key,
  - edge visits,
  - edge value.
  - edge virtual loss or in-flight marker if async/batched eval is added later.
- Root action stats are authoritative for final move selection.

Rules:

- Selection reads action stats from the current parent, not only child node
  stats.
- Backup updates each traversed parent-action edge and the reached node.
- Final move selection uses root edge visits.
- Shared child node value may inform selection, but must not replace per-edge
  visit/value accounting.
- Code comments should cite the KataGo graph-search note where the edge/node
  distinction is implemented.
- Current Rust status: `PositionKey`, `NodeId`, `GraphNode`, and `EdgeStats`
  exist with tests proving parent-action edge stats are distinct from shared
  child-node stats.

Cycle handling:

- Keep the current search path keys.
- Do not select an action that re-enters the active path.
- If every action cycles, pass or force rollout.

Start with simple position keys:

- Board contents.
- Player to move.
- Ko state.
- Consecutive pass count or recent pass state.

Add faster hashing only after correctness tests pass.

## Phase 5 — NN Policy/Value Adapter

When NN output is available, add an adapter outside `go-engine` if the model
runs in TypeScript, or inside the worker if the search moves there.

Adapter responsibilities:

- Convert policy output to `ActionPrior` entries.
- Mask illegal moves.
- Include pass if the model exposes pass probability.
- Normalize priors after masking.
- Convert value output to `[-1.0, 1.0]` from side-to-play perspective.

This should not change tree/graph MCTS. Only the evaluator changes.

If MCTS stays in Rust/WASM and NN stays in JS, use batched async evaluation
later. For the first PoC, prefer simpler sync random MCTS in Rust. Do not
prematurely contort Rust search around async NN calls until model latency is
known.

## Phase 6 — WASM API

Expose a small WASM method after Rust core is stable:

```ts
type RandomMctsRequest = {
  visits: number;
  rolloutLimit: number;
  seed: number;
};

type RandomMctsResponse = {
  move: { kind: "play"; col: number; row: number } | { kind: "pass" };
  visits: number;
  winrate: number;
  principalVariation: Array<{ col: number; row: number } | "pass">;
};
```

The frontend should still replay the returned move through the existing board
API. The bot search never mutates visible board state directly.

## Tests

Rust tests:

- Returns only legal moves.
- Deterministic for same seed.
- Handles pass and two-pass terminal positions.
- Captures an obviously capturable single stone on a tiny board.
- Does not choose suicide.
- Does not panic on full board.
- Visits budget is honored.

Performance smoke tests:

- 5x5: fixed visit count completes quickly.
- 9x9: mobile-plausible visit count measured before UI work.
- 13x13/19x19: benchmark only, not acceptance for v1.

WASM/frontend tests after exposure:

- Request/response shape.
- Cancellation or stale response handling if worker-based.
- Returned move is replayed through the board API.

## Acceptance Criteria

- `go-engine` can generate a legal move from a normal game position.
- Search is deterministic under a fixed seed.
- 9x9 search gives a move within the chosen mobile budget.
- Tests cover legality, pass handling, deterministic output, and simple tactics.
- Code remains isolated from NN runtime and product UI.

## Stop Conditions

Stop and rethink if:

- Random playouts are too slow for 9x9 even at weak visit counts.
- Move quality is worse than a simpler heuristic bot.
- Graph transpositions create hard-to-debug cycles before tree MCTS is useful.
- Search code starts duplicating too much rules logic from `Goban`.

## Recommendation

Build the evaluator/action boundary first, then implement KataGo-style graph
search with explicit parent-edge/action statistics. A tiny tree search scaffold
is acceptable only as a temporary way to test backup math and evaluator plumbing.
Do not expose product/WASM APIs that depend on tree-only internals.
