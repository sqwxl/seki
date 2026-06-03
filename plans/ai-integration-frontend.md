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
