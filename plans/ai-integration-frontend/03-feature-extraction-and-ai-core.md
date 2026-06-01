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

Add `genmove` after MCTS exists:

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
