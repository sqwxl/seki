# 02 — Model Cache and Worker Runtime

## Goal

Turn the PoC inference path into a reusable frontend AI runtime. This step owns
model manifest loading, IndexedDB cache behavior, worker lifecycle, cancellation,
stale response handling, and user-facing error states.

Do not build MCTS or the bot screen yet. Use fixed-position inference from plan
01 as the runtime's first functional path.

## Runtime Modules

Keep runtime code isolated under a frontend `ai/` module:

- `manifest` loader and validator.
- IndexedDB model/artifact cache.
- TF.js backend selection and warmup.
- Worker message types.
- Worker implementation.
- Main-thread worker client.
- Runtime error mapping.

The normal app bundle should not eagerly load TF.js. Load AI code only when a bot
or AI estimate screen asks for it.

## Model Cache Behavior

Use IndexedDB for downloaded model artifacts and metadata:

- Cache by model id and manifest version.
- Treat version mismatch as a cache miss.
- Keep enough metadata to show active model id, source version, stored bytes, and
  last-loaded time.
- Verify downloaded artifacts against the manifest checksum when available.
- Support clearing one model or all AI models.

Failure states must be explicit:

- Browser has no IndexedDB.
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
- A caller can initialize the worker, run fixed-position `estimate`, cancel it,
  and dispose the worker.
- Cached model artifacts are reused offline after first download.
- Clearing model cache forces a clean re-download.
- Every known failure state maps to a stable error code and readable message.
- Stale responses are ignored without changing visible app state.

## Test Plan

- Unit-test manifest validation and cache-key/version behavior.
- Unit-test worker client promise routing, stale response handling, cancellation,
  dispose, and error mapping with a mocked worker.
- Browser smoke test first download, cached startup, offline cached startup, and
  clear-cache behavior.
- Run `pnpm run typecheck` and targeted frontend tests.
