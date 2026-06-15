# 03 — Feature Extraction and AI Core

## Goal

Build the AI logic needed for move selection: board-position serialization,
KataGo-compatible feature extraction, NN evaluator wrapper, and MCTS. Keep this
independent from the bot screen so search behavior is testable without UI.

## Position Data

Define a serializable `AiPosition` shape shared by the bot screen and worker:

- Board size.
- Current board stones.
- Side to move.
- Ko state if present.
- Captures.
- Komi.
- Move history needed by the NN features.
- Stage/pass state needed for legal play.

Prefer data that can be exported from the visible `BoardController`/WASM engine
without exposing mutable engine internals. If a new WASM method is needed for a
clean snapshot, add it in `go-engine-wasm` as a thin wrapper over `go-engine`.

Current status:

- `seki-web/frontend/src/ai/position.ts` exports `aiPositionFromEngine`.
- It serializes a `WasmEngine`-shaped object into the current worker position
  shape: square board size, stones, side to move, komi, ko point, rules, and
  recent moves latest-first.
- Tests cover board stones, side to move, ko export, recent move order, and
  rejecting non-square boards.
- Standalone analysis now has a product-path AI suggestion toggle. On 9x9
  positions it snapshots the current board, sends an `analyze-position` request
  to the worker, displays the best move/winrate/timing in the status area, and
  overlays legal policy priors through native goban heatmap and faint ghost
  stone markup.
- AI suggestions are intentionally disabled in territory review. Entering
  review clears any visible suggestions and prevents stale worker responses
  from repainting the board.
- Standalone analysis and live-game analysis now share an analysis-session
  controller for local move-tree navigation, variation play/pass, pending move
  confirmation, AI suggestion, estimate overlays, and clearing variations.
- Shared 9x9 analysis estimate can use AI ownership output for goban paint
  maps. Manual estimate is a separate flow from AI suggestion: it shows its own
  pending state and paints ownership when ready.
- KataGo `OutputScoreValue` is raw model output. For current 6-channel exports,
  channel 2 is current-player lead and needs the KataGo lead multiplier
  (`20.0`) plus a sign flip for black-to-move to display White-minus-Black
  score (`W+N` / `B+N`).
- Estimate display now derives its shown score from AI ownership plus actual
  engine captures when ownership is available. This keeps score text aligned
  with the painted map and inferred dead stones; raw `OutputScoreValue` remains
  a fallback.
- Analysis estimate uses a canonical estimate snapshot: same stones, captures,
  and komi, with black-to-play and no recent pass/ko history. This keeps the
  same board position stable before and after a pass while preserving normal
  side-to-move snapshots for AI suggestions.
- Manual estimate uses a passive goban overlay, not territory-review state.
  Territory review is reserved for actual post-pass confirmation.
- Passive estimate overlays only provide paint/dim data. Last-move and ko
  markers continue to come from the board engine and are not cleared by
  estimate paint maps.
- Territory review after two passes can reuse the AI ownership path when the
  active model supports the board size, while unsupported boards fall back to
  the existing engine-only estimate.
- The product path currently uses the `direct` analysis preset: one legal-masked
  policy/value evaluation with the 9x9 KataGo model. Leaf MCTS remains a
  pondering/search path because 64-visit tap-to-move MCTS is too slow on Android.
- Rust MCTS leaf-value blending can now use deterministic KataGo-style
  pass-alive area scoring from `go-engine::territory::calculate_area`.
  This is area-style evaluation for search, not a direct replacement for the
  Japanese dead-stone list used by territory review.
- Analysis controls include a clear-variations button using `IconTrash`.
  Dedicated analysis removes stored tree/base/finalized/node data for the
  current board size and rebuilds the board. Live-game analysis preserves the
  live main line and removes only local branches. Both paths clear AI
  suggestion/estimate cache state.

Follow-up notes:

- Analysis estimate results are cached per position key in the shared
  analysis-session controller and invalidate on imported tree/komi/model
  changes.
- Finished-game estimate is viewable on any node by any user, including
  finalized nodes and games without settled territory.
- Live-game analysis estimate and AI suggestion are not dismissed by incoming
  moves while the user is in local analysis. Incoming moves update the live
  main-line reference and refresh active analysis modes. In live view, incoming
  moves still dismiss estimate and return to the live board.
- Pass-alive and independent-life area are implemented in `go-engine`, but not
  yet exposed through WASM for frontend diagnostics or overlays.

## Feature Extraction

Convert `AiPosition` to the NN input tensors expected by the selected model:

- Spatial feature planes.
- Global features.
- Batch dimension.
- Board-size masking if the selected model supports multiple sizes.

Keep feature extraction pure and testable. Do not read UI state, storage, or DOM.

## Evaluator

Wrap NN inference behind a small evaluator interface:

```ts
type AiEvaluation = {
  policy: Float32Array;
  winrate: number;
  ownership: Float32Array;
};

type AiEvaluator = {
  evaluate(position: AiPosition): Promise<AiEvaluation>;
};
```

Map model outputs once at the evaluator boundary. Downstream MCTS code should not
know TensorFlow tensor names, shapes, or backend details.

## MCTS

Implement search in two passes:

1. Fake deterministic evaluator.
   - Enables stable tests for tree expansion, PUCT scoring, legal move handling,
     pass handling, cancellation, and final move choice.
2. NN evaluator.
   - Reuses the same MCTS code with batched leaf evaluation.

MCTS uses a worker-local `go-engine-wasm` instance for legal move generation and
state transitions. The visible board still validates the final move returned by
the worker.

## Worker Additions

Current bridge API before product `genmove`:

```ts
type AnalyzePositionRequest = {
  id: string;
  type: "analyze-position";
  manifestUrl: string;
  backendPreference: "auto" | "webgpu" | "wasm";
  position: AiPosition;
  preset: "direct" | "mobile-fast" | "tuning";
};
```

This keeps product integration independent from the PoC buttons while MCTS
settings, model load behavior, and Android timings are still being tuned.

Add `genmove` after product call sites and cancellation semantics are clear:

```ts
type GenmoveRequest = {
  id: string;
  type: "genmove";
  position: AiPosition;
  strength: AiStrength;
};

type GenmoveResponse = {
  id: string;
  type: "genmove";
  move: { col: number; row: number } | "pass";
  winrate: number;
  ownership?: Float32Array;
};
```

Strength starts as visit counts against one model. Model swapping is deferred.

## Acceptance Criteria

- Feature extraction has fixed-position tests.
- Fake-evaluator MCTS tests are deterministic.
- NN evaluator returns policy, winrate, and ownership for fixed positions.
- MCTS only returns legal moves or pass.
- Cancellation stops long searches and prevents stale results from winning.
- Worker-local simulation and visible board validation agree on legal moves.

## Test Plan

- Unit-test `AiPosition` serialization from known engine states.
- Unit-test feature planes/global features for empty board, captures, ko, pass,
  and asymmetric positions.
- Unit-test evaluator output mapping against mocked tensors.
- Unit-test fake-evaluator MCTS move choice and pass behavior.
- Browser smoke test `estimate` and `genmove` through the worker on desktop and
  target Android/WebView.
