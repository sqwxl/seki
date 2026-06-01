# 04 — Board Integration and Bot Screen

## Goal

Add the user-facing local bot practice screen after the AI runtime can estimate
positions and generate legal moves.

## Board API Changes

Extend `BoardController` with small public APIs:

- `playMove(col, row): boolean`
  - Calls the same internal play path used by user clicks.
  - Triggers save, render, sounds/callbacks, and territory-review transition
    behavior consistently.
- `setPassiveOverlay(overlay?: TerritoryOverlay): void`
  - Renders AI ownership estimates without marking the board as territory review.
  - Does not block play.
  - Clears on navigation, reset, or when the position changes unless refreshed.
- Optional `exportAiPosition(): AiPosition`
  - If cleanest, export the worker snapshot from board/WASM instead of
    reconstructing it in the screen.

Do not have bot screen code call `board.engine.try_play()` directly.

## Route and Navigation

Add a `/bot` SPA route:

- Parse route in SPA router.
- Lazy-load bot screen module like analysis/game screens.
- Add navigation entry for non-bot users.
- Keep bot accounts restricted like other play routes.

No server data endpoint is required for local bot play.

## Bot Screen State

Track local-only state:

- Board size.
- Human color.
- Bot color.
- Strength preset.
- Active model/cache/backend status.
- Current AI request id.
- Bot thinking/cancel/error state.
- Latest winrate and ownership estimate.
- Game-over/final-score state.

Persist only harmless local preferences, such as last board size, color, and
strength. Do not persist local bot games as server games.

## Game Loop

1. Initialize board and AI worker.
2. If bot is black, request first bot move after board init.
3. On human move:
   - Clear stale passive overlay.
   - Cancel active AI work.
   - Export current `AiPosition`.
   - Request bot `genmove`.
4. On bot response:
   - Ignore if stale.
   - Validate by calling `BoardController.playMove()` or `pass()`.
   - Render latest winrate/ownership if included.
5. On pass/pass territory-review stage:
   - Use existing local territory review and scoring flow.

All reset, size change, color change, and route dispose paths must cancel active
worker work and ignore stale responses.

## UI

Reuse existing board layout and controls where practical. Add bot-specific
controls only for:

- Human color.
- Strength.
- Model/cache/backend status.
- Clear downloaded model.
- Estimate toggle or refresh.
- New game/reset.

Do not add marketing copy or a landing page. The route opens directly into the
practice board.

## Acceptance Criteria

- User can play a full local game against the bot.
- Bot moves are validated through the board API.
- Pass, territory review, final score, and SGF export work.
- AI ownership overlay does not block play.
- Reset/route changes cancel worker work and do not apply stale moves.
- No server game, ranking, notification, or presentation state is touched.

## Test Plan

- Frontend tests for `/bot` route parsing and lazy screen loading.
- Unit tests for `BoardController.playMove()` and passive overlay behavior.
- State tests for game loop stale response handling, reset, and cancel.
- Browser smoke test full short game, pass/pass scoring, SGF export, model status,
  and overlay toggle.
