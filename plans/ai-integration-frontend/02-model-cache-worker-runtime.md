# 02 — Model Cache and Worker Runtime

## Goal

Turn the PoC inference path into a reusable frontend AI runtime. This step owns
model manifest loading, browser Cache API behavior, worker lifecycle,
cancellation, stale response handling, and user-facing error states.

Do not build MCTS or the bot screen yet. Use fixed-position inference from plan
01 as the runtime's first functional path.

## Runtime Modules

Keep runtime code isolated under a frontend `ai/` module:

- `manifest` loader and validator.
- Cache API model/artifact cache.
- ONNX Runtime backend selection and warmup. TF.js remains PoC-only.
- Worker message types.
- Worker implementation.
- Main-thread worker client.
- Runtime error mapping.

The normal app bundle should not eagerly load TF.js. Load AI code only when a bot
or AI estimate screen asks for it.

## Model Cache Behavior

Use the browser Cache API for downloaded model artifacts:

- Cache by model artifact URL under `seki-ai-models-v1`.
- Treat changed artifact URLs as cache misses.
- Keep manifest metadata available to show active model id, source version, and
  declared bytes.
- Verify downloaded artifacts against the manifest checksum when available.
- Support clearing one model or all AI models.

Failure states must be explicit:

- Browser has no Cache API.
- Storage quota exceeded.
- Offline and required model is missing.
- Manifest fetch failed.
- Artifact fetch failed.
- Manifest version does not match cached artifacts.
- Backend init failed.
- Worker crashed or timed out.

## Worker Protocol

Use typed request/response messages with request ids:

```ts
type AiWorkerRequest =
  | { id: string; type: "init"; modelId: string }
  | { id: string; type: "estimate"; position: AiPosition }
  | { id: string; type: "cancel"; targetId: string }
  | { id: string; type: "dispose" };

type AiWorkerResponse =
  | { id: string; type: "ready"; backend: AiBackend; cache: AiCacheStatus }
  | { id: string; type: "estimate"; result: AiEstimate }
  | { id: string; type: "cancelled"; targetId: string }
  | { id: string; type: "error"; error: AiRuntimeError };
```

`genmove` is added in the AI core plan after MCTS exists.

The worker client must:

- Resolve/reject promises by response id.
- Ignore stale responses after reset, navigation, or dispose.
- Support cancelling the active request by id.
- Terminate and recreate the worker after unrecoverable errors.
- Release TF.js tensors on `dispose()`.

## Backend Selection

Backend choice is explicit:

1. Try WebGPU if available and allowed by the browser.
2. Fall back to WASM/XNNPACK with SIMD/threads when supported.
3. Fall back to CPU only with low-performance status.

The init response reports the selected backend and any fallback reason. The UI
later surfaces this in model/cache status.

## Acceptance Criteria

- AI runtime loads only on demand.
- A caller can initialize the worker, run fixed-position `analyze-position`, and
  ignore stale responses after cancellation/dispose.
- Cached model artifacts are reused offline after first download.
- Clearing model cache forces a clean re-download.
- Every known failure state maps to a stable error code and readable message.
- Stale responses are ignored without changing visible app state.

## Current Gaps

- The model cache exists, but service-worker activation must preserve
  `seki-ai-models-v1`; otherwise updates can delete downloaded models.
- The product worker wrapper is still minimal. It uses request ids and stale
  response guards at call sites, but not a full reusable worker-client class with
  explicit cancel/timeout/error-code semantics.
- Manifest checksum verification and clear-model UI are still pending.

## Test Plan

- Unit-test manifest validation and cache-key/version behavior.
- Unit-test worker client promise routing, stale response handling, cancellation,
  dispose, and error mapping with a mocked worker.
- Browser smoke test first download, cached startup, offline cached startup, and
  clear-cache behavior.
- Run `pnpm run typecheck` and targeted frontend tests.
