# 05 — Mobile Performance and Release

## Goal

Turn the working bot screen into a releasable v1 by locking mobile performance
budgets, fallback behavior, smoke tests, and docs.

## Mobile Acceptance Target

Pick one required Android/WebView device and record:

- Device model.
- Android version.
- WebView/Chrome version.
- Available storage class.
- Whether WebGPU is available.
- Whether WASM SIMD/threads are available.

All mobile v1 acceptance criteria are measured against this target.

## Performance Budgets

Set budgets from PoC data before release:

- First model download size.
- Stored model size.
- Worker init + model load time.
- Warmup time.
- `estimate` p95 latency.
- `genmove` p95 latency per strength preset.
- Memory ceiling before worker restart or lower-strength fallback.

If a preset misses the target budget on mobile, hide it on mobile or label it as
desktop-only.

## Fallback UX

Ship clear states for:

- First model download.
- Offline with cached model.
- Offline without cached model.
- Low-performance backend.
- Backend init failure.
- Quota exceeded.
- Worker crash/restart.

Mobile defaults:

- Small default model.
- Conservative visit counts.
- Pondering off.
- Cancel on every user action that changes position.

## Release Checklist

- README checklist updated for offline bot play.
- Frontend spec updated for `/bot` route and local-only behavior.
- Any new dependencies reviewed for dependency tree size and browser payload.
- Build config keeps AI/TF.js out of the initial app bundle where possible.
- Static model assets have provenance and checksums.
- No server API, DB migration, or rank path is affected.

## Test Plan

- `pnpm run typecheck`.
- Targeted Vitest suites for AI runtime, worker client, board API, and bot state.
- `pnpm run build`.
- Desktop browser smoke:
  - First download.
  - Cached reload.
  - Offline cached reload.
  - Full local bot game.
  - SGF export.
- Android/WebView smoke:
  - First download.
  - Cached reload.
  - Offline cached reload.
  - One game through scoring.
  - Worker cleanup after route leave.

## Go/No-Go

Ship v1 only if:

- Target Android/WebView meets the agreed budgets.
- Desktop remains stable.
- No initial app load regression from AI dependencies.
- Local-only bot behavior cannot affect ranking or server game state.

If mobile misses budget but desktop works, either defer release or explicitly
scope v1 to desktop. Do not silently ship a broken mobile-first feature.
