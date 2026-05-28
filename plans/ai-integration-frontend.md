# AI Integration — Frontend

> Paired with [`ai-integration-backend.md`](./ai-integration-backend.md).
> Client and server AI are independent implementations; they don't share code.

## Intent

Add client-side bot gameplay. The bot runs NN-guided MCTS in the browser using KataGo model weights. Model weights are fetched once and cached in IndexedDB; after that, no network connection is required. Gameplay reuses existing board components (goban, controls).

Client-side bot gameplay is for practice only, game outcomes have no impact on a player's rank.

Rules enforcement, move validation, and territory scoring remain in `go-engine` (compiled to WASM). The bot is only responsible for move selection.

## Components

### Local bot (Web Worker)

Runs in a dedicated Web Worker. Contains the full NN + MCTS pipeline:

- **Model parser** — reads KataGo `.bin.gz` weight files. Handles the mixed text+binary format, extracts conv/batchnorm/matmul weights as raw float32 arrays.
- **Feature extraction** — converts a board position to the 22 spatial + 19 global input channels that the NN expects. Pure typed-array math, no TF.js dependency.
- **Forward pass** — runs the NN (residual conv blocks + policy/value/ownership heads) using TF.js. The WebGPU backend is preferred; falls back to WASM/XNNPACK then plain JS CPU.
- **MCTS search** — PUCT-guided tree search. Collects leaf positions in batches for efficient NN evaluation. Produces a move, optionally returns ownership and winrate.

### Worker interface

Exposed via `postMessage`:

- `init(modelUrl)` — fetch, decompress, parse model weights. Build TF.js tensors. Warm up backend.
- `genmove({position, visits?})` — run MCTS and return the best move.
- `cancel()` — abort the current search.
- `estimateOwnership({position})` — single NN forward pass, return per-point territory prediction.

The worker ponders (searches opponent responses) while waiting for the human move. Pondering is cancelled when the human plays.

### Board integration

- A new "Bot" screen creates a `BoardController` (same as analysis and live games) with no server dependency.
- When it's the bot's turn, the screen sends the current position to the worker, waits for a move, and plays it into the board.
- Scoring, territory review, and SGF export work exactly as they do today because the board controller owns all of that.

### Local territory estimation

- `estimateOwnership` provides NN-based per-point territory prediction.
- Non-authoritative — for the player's information during a game.
- The existing `TerritoryOverlay` rendering path already supports this data shape.

### Backend fallback

TF.js automatically selects the best available backend: WebGPU → WASM/XNNPACK (SIMD + threads) → plain JS CPU. The worker reports which backend is active so the UI can surface it. On devices without a GPU, the smaller model and lower visit counts keep play responsive.

## Relationship to existing platform

| Piece                                         | Role                                                                  |
| --------------------------------------------- | --------------------------------------------------------------------- |
| `go-engine` + `go-engine-wasm`                | Unchanged. Rules, move validation, board state, territory review.     |
| `create-board.tsx` / `BoardController`        | Unchanged. Bot screen uses the same board as analysis and live games. |
| `goban.tsx`, `controls.tsx`, `GamePageLayout` | Reused as-is for the bot screen.                                      |

New pieces:

| Piece                        | Purpose                                                                              |
| ---------------------------- | ------------------------------------------------------------------------------------ |
| Model parser (TS)            | Reads KataGo `.bin.gz` format, extracts weights.                                     |
| Feature extraction (TS)      | Board position → 22+19 input channels.                                               |
| NN forward pass (TS + TF.js) | Conv blocks + policy/value/ownership heads.                                          |
| MCTS search (TS)             | PUCT-guided tree search with batch evaluation.                                       |
| Web Worker glue              | Orchestrates the above, exposes `init`/`genmove`/`cancel`/`estimateOwnership`.       |
| TS worker client             | Wraps `postMessage` in a promise-based API for the main thread.                      |
| Bot screen                   | Orchestrates a local game loop with the worker, using the existing board controller. |
| Static model assets          | Model `.bin.gz` files served from `seki-web/static/models/`.                         |

## Open questions

### Model format compatibility

KataGo models from https://katagotraining.org/networks/ use the V8+ binary format (currently versions 8–14). The parser needs to handle the union of formats across the models we ship. Newer models may add post-process parameters (V13) or nested bottleneck blocks (V9+).

### Model selection and strength

We ship one small model by default. Users can optionally download larger models. Strength is controlled at runtime via visit count. Open questions:

- Which model to ship as default? Tradeoff: download size vs. strength.
- How many strength presets? Map to visit counts or also allow model swapping.

### Pondering strategy

The worker searches opponent responses while the human thinks. Should pondering use fewer visits than the main search? Should it be disabled entirely on low-power devices?

### Android

TF.js WebGPU support in Android WebView is the main constraint. The WASM/XNNPACK fallback needs to be fast enough for acceptable play on mobile. Model size also impacts mobile download and storage.
