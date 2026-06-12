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
- Product analysis now has a 9x9 AI suggestion toggle using one direct
  legal-masked policy/value eval. It renders move-rank heatmaps, faint ghost
  stones, and AI status without entering bot-play mode.
- Product analysis and live-game estimate can use 9x9 AI ownership output.
  Manual estimate is a passive paint overlay, separate from territory-review
  confirmation, and falls back to the engine estimate when AI is unavailable.
- Estimate score display is derived from ownership plus captures/komi when
  ownership exists. Raw KataGo `OutputScoreValue` remains a diagnostic/fallback,
  not the primary UI score.
- Estimate cache is now position-shaped for analysis: board stones, captures,
  and komi. It intentionally ignores pass turn/history so the same board before
  and after a pass shows the same estimate.
- Analysis controls include a clear-variations button using `IconTrash`. It
  clears stored tree/base/finalized/node state for the current analysis board
  size and resets AI overlay/cache state.
- Rust/WASM owns the experimental legal-move search path: graph MCTS, batched
  external leaf eval, recursive node-value recomputation, and parent-edge
  catch-up. This remains PoC/search-lab work until pondering exists.

Next overall steps:

1. Finish the remaining board API needed by the bot screen, especially a public
   `playMove(col, row)` path that uses the same legality/render/save callbacks
   as normal user clicks.
2. Scaffold `/bot` as a local-only practice screen with model/backend status,
   strength preset, reset, estimate overlay, and stale-response cancellation.
3. Use direct policy for immediate bot moves at first. Keep MCTS for slower
   stronger settings and future pondering, because tap-time MCTS is still too
   slow on current Android benchmarks.
4. Keep PoC search diagnostics and transposition-heavy benchmarks as parallel
   lab work before promoting MCTS defaults into product UI.
