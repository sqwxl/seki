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

- Product neural-network policy/value integration outside the PoC worker.
- Pondering in the first move-selection API.
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
- Value comes from rollout result when terminal, otherwise from a weak
  KataGo-style smooth score utility:
  `atan(score_diff / (2 * sqrt(board_area))) * 2/pi`.
- Current Rust status: `go-engine::mcts` has action/evaluation types,
  `legal_actions`, `uniform_priors`, `apply_action`, deterministic PRNG, and
  `RandomRolloutEvaluator`.

For NN later:

- Priors come from policy output after legal-move masking and softmax.
- Value comes from value head.
- Rollouts can be disabled, or used only as a fallback if value is unavailable.
- Current Rust/WASM status: root NN policy logits can seed the root priors via
  `RootPolicyRolloutEvaluator`; child/leaf expansion still uses rollout
  fallback until the worker owns an async batched evaluator loop.

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
- Current Rust status: first `search`/`genmove` graph driver exists with PUCT
  selection, expansion from evaluator priors, edge/node backup, and final move
  by root edge visits.
- Current Rust status: active-path cycle guard exists, following KataGo's
  `graphPath` approach at a single-thread level. Selection skips children
  already on the path; if every child cycles, the chosen cycle edge is counted
  and the playout terminates with neutral value. Batching and WASM API are still
  pending.

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

Current Rust/WASM status:

- `WasmEngine.random_mcts_json(requestJson)` exists.
- It runs sync random-rollout graph MCTS against the current visible replay
  position.
- It returns best move, side-to-play winrate, root value, root edge stats, and
  a one-move principal variation placeholder.
- It does not mutate visible board state.
- `wasm-pack build` generates bindings with `random_mcts_json`.
- `/static/ai-poc.html` has a separate `Run Rust random MCTS` path through the
  AI PoC worker. This supplements the temporary TypeScript policy-MCTS probe
  instead of replacing it.
- Random-rollout MCTS now has temporary baseline priors and an action cap for
  benchmarking/no-model fallback only. NN policy output should replace these
  priors at the evaluator boundary; the graph MCTS core should remain unchanged.
- Random-rollout leaf value now avoids hard-clamping raw point margin. Terminal
  rollouts return a win/loss sign; non-terminal score estimates use a
  KataGo-like arctangent transform scaled by `sqrt(board_area)`.
- `/static/ai-poc.html` has a `Run Rust root-policy MCTS` path. The worker runs
  one ONNX inference on the root position, sends legal-masked policy logits and
  root value to `go-engine-wasm`, and Rust graph MCTS uses rollout fallback for
  non-root leaves. This is an integration bridge, not full NN-guided MCTS.
- `go-engine::mcts::ExternalMctsSearch` now supports resumable external
  evaluation. `go-engine-wasm` exposes this as a search object with
  `next_batch_json`, `apply_batch_json`, and `summary_json`.
- `/static/ai-poc.html` has a `Run Rust leaf-policy MCTS` path. Rust owns graph
  search and legal move generation; the worker evaluates requested leaves with
  ONNX and feeds policy/value back into Rust.
- Current leaf-policy path encodes requested leaves into one ONNX batch tensor
  when the model layout supports KataGo-style `bin_input`/`global_input` or
  `InputMask`/`InputSpatial`/`InputGlobal` inputs. Benchmark output reports
  `modelEvaluations`, `modelBatches`, `modelEvalMs`, `wasmSearchMs`, and
  `totalElapsedMs`.
- Android batched eval tests currently favor batch size 16 over 32. Warm-tab
  WebGPU measurements on Chrome Android:
  - 64 visits / 16 MCTS max children / 16 eval batch: ~3.3s total.
  - 96 visits / 16 MCTS max children / 16 eval batch: ~4.5s total.
  - 128 visits / 16 MCTS max children / 16 eval batch: ~5.7s total.
  - 128 visits / 16 MCTS max children / 32 eval batch: ~6.4s total.
- `/static/ai-poc.html` exposes named MCTS presets for the current Android-fast,
  Android-stronger, and lab 128 settings.
- Position presets now include three 19x19 mainline snapshots from
  `3hlu-gokifu-20260603-Li_Xiangyu-Jiang_Weijie.sgf` at moves 32, 72, and 120.
  These give the PoC non-empty pro-game positions for quality and latency tests.
- Position presets also include two fixed 9x9 boards derived from local KataGo
  tests:
  - `katago-search-sparse-9x9` from `vendor/KataGo/cpp/tests/testsearchnonn.cpp`
    sparse-board search coverage.
  - `katago-local-contact-9x9` from `vendor/KataGo/cpp/tests/testsearchv9.cpp`
    local contact / avoid-move-style coverage.
  These are not expected-answer tests yet. They are stable tactical benchmark
  inputs for direct policy, catch-up behavior, and 9x9 search tuning.
- Fix from 2026-06-06: direct-policy ranking and leaf-policy MCTS now both use
  Rust-side explicit-position helpers. This matters for presets that have
  stones but no move history; the earlier MCTS path only replayed
  `recentMoves`, so those 9x9 presets were accidentally searched as empty
  boards.
- Latest Chrome Android 9x9 rerun after that fix:
  - `katago-search-sparse-9x9`, direct policy and MCTS root policy match
    exactly; both pick `E5`.
  - `katago-local-contact-9x9`, direct policy and MCTS root policy agree on
    `D5`; later top-policy ordering differs only among near-equal priors.
  - Leaf-policy MCTS with 64 visits / 16 max actions / 16 eval batch still
    takes about 23s on Android. Rust search is only tens of milliseconds;
    model evaluation dominates.
  - Direct policy remains about 2s cold-ish and is the better tap-to-move
    baseline until pondering exists.
- Current Rust graph search is being moved toward KataGo's canonical recursive
  value formulation: each node stores its direct evaluator value, parent-action
  edge visits remain distinct from child visits, and node values are recomputed
  from direct value plus edge-visit-weighted child values.
- Transposition catch-up now follows KataGo's default shortcut: when a selected
  child node has more visits than the parent-action edge, the search increments
  the edge visit and recomputes ancestors without descending or requesting
  another NN eval.
- Latest Chrome Android runs on the Li/Jiang move 32/72/120 presets after
  canonical recursive aggregation and catch-up were stable:
  - 64 visits / 16 max children / 16 eval batch: about 3.2-3.4s total, best
    moves `L14`, `S12`, `P18`.
  - 96 visits / 16 max children / 16 eval batch: about 4.6-4.9s total, best
    moves `L14`, `S12`, `P18`.
  - The stronger preset did not materially change top-move choice on those
    three snapshots.
- Catch-up has not been observed firing on the current Android benchmark set
  yet. Recent exports still showed `modelEvaluations == visits`, so these
  positions are not creating the kind of transposition reuse needed to validate
  that optimization.
- Search diagnostics are now included in PoC exports: readable root move labels,
  principal variation labels, catch-up/cycle/terminal counters, root visit
  entropy, visited root move count, and visited root policy mass.
- Latest Chrome Android `corner-exchange` run with `64 / 16 / 16` stayed around
  3.3s warm-tab total with best move `D4`, principal variation `D4 -> Q16`,
  `visitedRootMoves: 16`, and `catchUpVisits: 0`.
- Current implementation step: first-play urgency (FPU) reduction avoids
  treating every unvisited edge as neutral value. The PoC exposes
  `fpuReduction` as a numeric control; benchmark `0.2`, `0.5`, and `1.0`
  before further tuning.
- FPU tuning result on Chrome Android `corner-exchange`, `64 visits`,
  `16 max children`, and `4 eval batch`:
  - `fpuReduction: 0.2`: visits all 16 root moves; too flat for tuning.
  - `fpuReduction: 0.5`: visits 9 root moves; useful middle ground.
  - `fpuReduction: 1.0`: visits 4 root moves; likely too narrow at 64 visits.
- `/static/ai-poc.html` includes a `Tuning (64 / 16 / 4 / FPU 0.5)` preset for
  search-quality experiments. Keep `Android fast (64 / 16 / 16 / FPU 0.2)` as
  the speed/default mobile preset for now.
- Tuning preset result on Chrome Android Li/Jiang snapshots:
  - Move 32: ~5.3s total, best `N13`, visited 9 root moves, first observed
    catch-up with `catchUpVisits: 2` and `modelEvaluations: 62` for 64 visits.
  - Move 72: ~4.9s total, best `S12`, visited 9 root moves.
  - Move 120: ~5.0s total, best `L16`, visited 10 root moves.
  - Compared with Android fast, tuning is roughly 1.5-1.8s slower because eval
    batch count rises from 5 to 17, but the root distribution is more
    search-shaped and less force-visited by batching.
- Remaining KataGo gaps after that step: virtual loss / real parallelism,
  dynamic cpuct, root noise/temperature, LCB selection, full feature encoding,
  leaky catch-up tuning, and Go-specific repetition hash safety.
- The PoC worker now has a first stable engine-facing request shape:
  `type: "analyze-position"`. It accepts an explicit serialized position,
  model manifest URL, backend preference, and preset id. Internally it reuses
  the Rust leaf-policy MCTS path and returns a product-shaped analysis object
  with best move, winrate, principal variation, root move stats, diagnostics,
  and timing breakdown.
- Current `analyze-position` presets:
  - `direct`: one model eval, legal-masked policy/value, no search.
  - `mobile-fast`: 64 visits, 16 max policy actions, eval batch 16, FPU 0.2.
  - `tuning`: 64 visits, 16 max policy actions, eval batch 4, FPU 0.5.
  Use `direct` for non-pondering tap-to-move suggestions. Product strength
  settings should leave room for slower/better search when pondering has already
  warmed the tree between opponent moves.
- The worker now supports KataGo policy optimism for official ONNX exports with
  two policy channels. It blends normal and optimistic logits using KataGo's
  backend formula: `normal + (optimistic - normal) * policyOptimism`.
  Default remains `0.0` for normal policy. Benchmark `0.5` and `1.0` as lab
  settings only.
- The PoC worker now has an explicit `direct-policy` path. It runs one ONNX
  evaluation, replays the position into `go-engine-wasm`, legal-masks policy
  logits, and reports the best legal move plus top legal priors. This replaces
  using a confusing `1 visit` MCTS run as the immediate-move baseline.
- Current mobile direction:
  - Immediate move: direct policy/value with a loaded model.
  - Stronger move: MCTS only when pondering can spend background time.
  - Tap-to-move MCTS without pondering is too slow for the 9x9 B18C384 model
    on Android because model eval dominates search time.
- Chrome Android direct-policy result on empty 9x9:
  - `policyOptimism: 0.0`: total ~2.14s, model eval ~1.20s, best `D6`.
  - `policyOptimism: 0.5`: total ~1.51s, model eval ~0.80s, best `D6`.
  Timing variance appears warm-tab/cache-related; optimism changes move ordering
  slightly but not the best move on empty board.
- Next pending steps:
  1. Benchmark the KataGo-derived 9x9 presets with direct policy and
     leaf-policy MCTS to see whether they expose useful tactical differences or
     transposition/catch-up behavior.
  2. Start adapting the product-facing bot path to call `analyze-position`
     instead of PoC-only button handlers.
  3. Keep mobile presets conservative until pondering exists; slower/better
     settings should mostly spend ponder budget, not block every tap.

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
