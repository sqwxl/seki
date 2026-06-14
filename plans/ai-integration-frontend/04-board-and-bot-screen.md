# 04 — Board Integration and Bot Screen

## Goal

Add the user-facing local bot practice screen after the AI runtime can estimate
positions and generate legal moves.

## Board API Changes

Extend `BoardController` with small public APIs:

- Done: `setPassiveOverlay(overlay?: TerritoryOverlay): void`
  - Renders AI ownership estimates without marking the board as territory review.
  - Does not block play.
  - Preserves board-owned props such as last-move and ko markers; the overlay
    only supplies paint/dim data.
  - Clears on navigation, reset, or when the position changes unless refreshed.
- Done: `playMove(col, row): boolean`
  - Calls the same internal play path used by user clicks.
  - Triggers save, render, sounds/callbacks, and territory-review transition
    behavior consistently.
- Optional `exportAiPosition(): AiPosition`
  - If cleanest, export the worker snapshot from board/WASM instead of
    reconstructing it in the screen.

Do not have bot screen code call `board.engine.try_play()` directly.

Current prerequisite status:

- Analysis already proves passive overlays, AI suggestion heatmaps, AI ghost
  stones, AI ownership estimate, and direct-policy worker calls in product UI.
- Analysis has a clear-variations button using `IconTrash`; bot screen reset can
  follow the same "clear local state, rebuild board, clear AI cache" shape.
- Bot screen uses the public `playMove` API for direct-policy moves.

## Route and Navigation

Add a `/bot` SPA route:

- Done: parse route in SPA router.
- Done: lazy-load bot screen module like analysis/game screens.
- Done: add navigation entry for non-bot users.
- Done: keep bot accounts restricted like other play routes.

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
   - If the human just passed and the AI score estimate says the bot is not
     behind, pass instead of taking the greedy direct-policy move.
   - Validate by calling `BoardController.playMove()` or `pass()`.
   - Render latest winrate/ownership if included.
5. On pass/pass territory-review stage:
   - Skip manual territory review for local bot games.
   - Request an AI estimate, normalize ownership to black/neutral/white, compute
     final local score, show the result in the game status, and keep New Game as
     the primary next action.

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

Do not add SGF export to local bot practice v1.

## Acceptance Criteria

- User can play a full local game against the bot.
- Bot moves are validated through the board API.
- Pass/pass final scoring works without manual territory review.
- AI ownership overlay does not block play.
- Reset/route changes cancel worker work and do not apply stale moves.
- No server game, ranking, notification, or presentation state is touched.

## Test Plan

- Frontend tests for `/bot` route parsing and lazy screen loading.
- Unit tests for `BoardController.playMove()` and passive overlay behavior.
- State tests for game loop stale response handling, reset, and cancel.
- Browser smoke test full short game, pass/pass scoring, model status, and
  overlay toggle.

Current next tests:

- Stale direct-policy response ignored after reset/dispose.
- Bot-black opening request does not race board initialization.
- Pass/pass skips local territory review and shows AI-finalized score.
- Takeback removes the bot reply and returns to the human turn.
- Browser smoke test short game, pass/pass scoring, model status, hints,
  estimate, reset, and route disposal.
