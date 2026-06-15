# AI Integration Frontend — Overview

## Intent

Add client-side bot gameplay for practice. The bot runs browser-local neural
network inference using preconverted KataGo-derived model artifacts. Current
product code uses direct legal-masked policy/value for tap-time bot moves;
NN-guided MCTS is implemented as a worker/Rust-WASM search path but remains a
tuning path, not the default bot move path. Model artifacts are fetched once,
cached in the browser Cache API, and reused offline.

Client-side bot games are local only. They never affect player rank, server game
history, notifications, or shared presentation state.

Rules enforcement, move validation, and scoring stay in `go-engine` compiled to
WASM. The bot selects moves; `go-engine-wasm` remains the source of truth for
legal play, ko, pass handling, and final scoring.

## V1 Scope

Full practice mode:

- Local game against a bot on the existing board UI.
- Direct-policy bot moves for v1, with MCTS retained for slower stronger modes
  and future pondering.
- NN ownership estimate and winrate display for the current position.
- Pass/pass final scoring without manual territory review, using engine
  dead-stone detection plus Japanese territory/capture scoring.
- Offline reuse after the first model download.

Out of scope for v1:

- Runtime parsing of raw KataGo `.bin.gz` files in the browser.
- Ranked or server-persisted bot games.
- Pondering on mobile by default.
- Importing arbitrary user-provided model files.
- SGF export from local bot practice.

## Ordered Plan Set

1. `01-nn-conversion-browser-inference-poc.md`
   - Prove the model conversion and browser inference path before product work.
2. `02-model-cache-worker-runtime.md`
   - Add durable model loading, cache, worker protocol, cancellation, and errors.
3. `03-feature-extraction-and-ai-core.md`
   - Build board features, NN evaluator wrapper, and MCTS.
4. `04-board-and-bot-screen.md`
   - Add board API support, passive AI overlay, `/bot` route, and game loop.
5. `05-mobile-performance-and-release.md`
   - Lock mobile budgets, smoke tests, fallback UX, and release checklist.
6. `06-random-playout-mcts-engine-poc.md`
   - Alternate proof path: model-agnostic MCTS with random playout evaluator,
     designed so NN policy/value can replace the evaluator later.

Each plan should be implemented only after the prior plan's acceptance criteria
pass. This prevents UI and MCTS work from depending on an unproven inference path.

## Architecture Summary

The browser AI path has four layers:

- **Model artifacts:** generated offline from one selected model and served from
  `seki-web/static/models/`.
- **AI worker:** owns TF.js, model loading, backend selection, `go-engine-wasm`
  simulation state, NN evaluation, and MCTS.
- **Worker client:** typed request/response wrapper with request ids,
  cancellation, stale response handling, and error mapping.
- **Bot screen:** local UI orchestration over the existing board and controls.

The visible board remains the authority for what the user sees. Every bot move
returned by the worker is replayed through a public board method so normal
validation, rendering, sounds, storage, pass handling, and final scoring
and local state remain consistent.

## Shared Defaults

- Mobile is the v1 performance target.
- Start with one small default model.
- Start strength presets as visit-count presets against that model.
- Keep pondering off by default on mobile.
- Keep AI code isolated under a frontend `ai/` module.
- Do not add server routes or database changes for local bot games.

## Global Open Questions

- Default product model is currently `kata9x9-b18c384nbt-20231025`.
- Required Android/WebView target device, needed for measurable acceptance.
- Whether desktop-only higher strength presets are worth exposing after mobile
  performance is proven.
- How to present model ownership, engine Japanese dead-stone scoring, and
  KataGo-style pass-alive area without implying they are the same scoring rule.
