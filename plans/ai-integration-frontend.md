# AI Integration — Frontend

> Paired with [`ai-integration-backend.md`](./ai-integration-backend.md).
> Client and server AI are independent implementations; they don't share code.

This plan is split into ordered feature plans under
[`ai-integration-frontend/`](./ai-integration-frontend/). Read and implement in
order:

1. [`00-overview.md`](./ai-integration-frontend/00-overview.md)
2. [`01-nn-conversion-browser-inference-poc.md`](./ai-integration-frontend/01-nn-conversion-browser-inference-poc.md)
3. [`02-model-cache-worker-runtime.md`](./ai-integration-frontend/02-model-cache-worker-runtime.md)
4. [`03-feature-extraction-and-ai-core.md`](./ai-integration-frontend/03-feature-extraction-and-ai-core.md)
5. [`04-board-and-bot-screen.md`](./ai-integration-frontend/04-board-and-bot-screen.md)
6. [`05-mobile-performance-and-release.md`](./ai-integration-frontend/05-mobile-performance-and-release.md)
7. [`06-random-playout-mcts-engine-poc.md`](./ai-integration-frontend/06-random-playout-mcts-engine-poc.md)

The top-level intent remains: add local client-side bot practice using
preconverted KataGo-derived model artifacts, browser inference, and existing
`go-engine-wasm` rule/scoring behavior. Local bot games are practice only and
never affect ranking, server game history, notifications, or shared presentation
state.

Plan 06 is an alternate proof path while small browser-friendly neural-network
artifacts are unresolved. It keeps MCTS policy/value-agnostic so random playouts
can be replaced by model output later.

Current overall status:

- Browser ONNX inference PoC is working with official small-model artifacts and
  warm-tab WebGPU on Chrome Android.
- Rust/WASM now owns the real legal-move search path for the PoC: graph MCTS,
  batched external leaf eval, recursive node-value recomputation, and
  parent-edge catch-up.
- Current interactive Android presets are:
  - `Android fast`: 64 visits / 16 max children / 16 eval batch, about
    3.2-3.4s on tested 19x19 pro-game snapshots.
  - `Android stronger`: 96 visits / 16 max children / 16 eval batch, about
    4.6-4.9s on the same snapshots.
- Best moves are stable across those two budgets on the current Li/Jiang move
  32/72/120 presets.
- Catch-up logic is implemented, but the latest Android runs still showed
  `modelEvaluations == visits`, so the tested positions did not trigger it yet.

Next overall steps:

1. Add search diagnostics to make graph behavior visible in the PoC output:
   root edge summaries, PV beyond one move, visit spread/entropy, and explicit
   catch-up counters.
2. Benchmark more transposition-heavy or tactical presets to validate that
   catch-up reduces leaf eval requests in practice.
3. Use those measurements to lock the first engine-facing `analyzePosition()`
   API and default mobile search presets before wiring the search into real bot
   gameplay UI.
