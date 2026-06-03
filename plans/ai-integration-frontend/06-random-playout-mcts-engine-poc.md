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
- KataGo graph-search note:
  `https://github.com/lightvector/KataGo/blob/master/docs/GraphSearch.md#doing-monte-carlo-graph-search-correctly`

## Scope

Build in `go-engine` first. Expose through WASM only after the core search is
deterministic, tested, and reasonably fast.

In scope:

- Legal move generation, including pass.
- Random rollout evaluation behind a pluggable policy/value interface.
- Tree MCTS baseline.
- Deterministic search seeds for tests.
- Small-board performance checks.
- NN policy/value adapter shape, without requiring a model in this phase.
- Later graph-search upgrade with edge/action statistics.

Out of scope:

- Neural-network policy/value evaluation.
- Pondering.
- Product bot UI.
- Server-side bot games.
- Ranked play.
- Advanced life-and-death solver.

## Core Design

Add a small search module under `go-engine`, for example `mcts/`.

Separate search from evaluation:

- **Search core:** tree/graph traversal, visit counts, action selection, backup.
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

Implement tree MCTS before graph MCTS.

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

## Phase 4 — Graph Search Upgrade

After tree MCTS is correct, add a transposition table.

Follow the KataGo graph-search warning: parent action statistics are not the
same as child node statistics. Track edge/action visits separately from node
visits.

Required graph state:

- Position key.
- Node visits/value.
- Per-parent action stats:
  - action,
  - child key,
  - edge visits,
  - edge value.

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

Build tree MCTS first. Do not implement graph search until tree MCTS has tests,
benchmarks, and a WASM-facing API shape. Graph search is valuable, but only after
the baseline proves that random playouts are fast enough and not obviously bad.
