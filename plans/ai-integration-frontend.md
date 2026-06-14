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
- Product analysis and live-game analysis share an analysis-session controller
  for local move-tree navigation, variations, AI suggestion, estimate overlays,
  and clearing variations. 9x9 estimate can use AI ownership output and falls
  back to the engine estimate when AI is unavailable.
- Estimate score display is derived from ownership plus captures/komi when
  ownership exists. Raw KataGo `OutputScoreValue` remains a diagnostic/fallback,
  not the primary UI score.
- Estimate cache is now position-shaped for analysis: board stones, captures,
  and komi. It intentionally ignores pass turn/history so the same board before
  and after a pass shows the same estimate.
- Analysis controls include a clear-variations button using `IconTrash`.
  Dedicated analysis clears stored tree/base/finalized/node state for the
  current board size; live analysis preserves the live main line and removes
  local branches. Both reset AI overlay/cache state.
- Board API now exposes `playMove(col, row)` and passive overlays, with
  targeted frontend coverage.
- `/bot` is scaffolded as a local-only 9x9 practice screen using direct-policy
  AI moves, stale-response guards, setup persistence, hints, estimate, pass,
  resign, reset, and takebacks.
- `/bot` has a direct-policy pass heuristic: after the human passes, the bot
  passes too when the AI score estimate says the bot is not behind.
- `/bot` skips manual territory review after two passes. It finalizes the local
  result from AI ownership normalized to black/neutral/white points.
- Rust/WASM owns the experimental legal-move search path: graph MCTS, batched
  external leaf eval, recursive node-value recomputation, and parent-edge
  catch-up. This remains PoC/search-lab work until pondering exists.

Next overall steps:

1. Stabilize `/bot`: add focused tests for stale AI responses, reset/dispose
   cancellation, pass/pass final scoring, and takeback behavior.
2. Add visible model/backend status to `/bot` from the existing AI worker path.
3. Browser-smoke `/bot` on desktop and Android Chrome: short game, bot-black
   opening move, pass/pass scoring, hints, estimate, reset, and route disposal.
4. Keep direct policy as the default bot move path for now. Keep MCTS for slower
   stronger settings and future pondering, because tap-time MCTS is still too
   slow on current Android benchmarks.
5. Keep PoC search diagnostics and transposition-heavy benchmarks as parallel
   lab work before promoting MCTS defaults into product UI.
