# Quickstart: Ranked Game Form Redesign

## Implementation Sequence

1. Add migration `seki-web/migrations/003_max_handicap.sql` adding `max_handicap INTEGER` to the `games` table.
2. Add `max_handicap` field to the `Game` struct, `Game::create`, and `RankedGameSnapshotUpdate` in `seki-web/src/models/game.rs`.
3. Add `max_handicap` to `CreateGameParams` in `seki-web/src/services/game_creator.rs` and pass through to `Game::create`.
4. In `seki-web/src/services/game_joiner.rs`, cap the derived handicap by `game.max_handicap` when joining a rated open game.
5. Extend `NewGameData` DTO with `eligible_opponents` in `seki-web/src/routes/web_api.rs`. Populate the filtered opponent list for direct challenges.
6. Split `seki-web/frontend/src/layouts/game-settings-form.tsx` into an orchestrator and `form-variants/open-game.tsx`, `form-variants/direct-challenge.tsx`, `form-variants/email-invite.tsx`.
7. Implement variant selection UI (radio group) and rated/unrated toggle gating per variant.
8. Implement derived settings preview for rated direct challenge opponent selection.
9. Implement max handicap slider for rated open games (0–9).
10. Wire form submission with variant-specific parameters (`variant`, `max_handicap`, `invite_message`).
11. Update `FRONTEND_SPEC.md` game creation section and `README.md` checklist.
12. Add focused frontend tests for variant switching and rated/unrated gating.

## Verification Commands

From repo root:

```bash
cargo test -p seki-web
cargo check --all
```

From `seki-web/frontend/`:

```bash
pnpm run typecheck
pnpm test
```

## Manual Checks

1. Open `/games/new` as an unregistered user. Confirm Rated checkbox is disabled with tooltip on all variants.
2. Open `/games/new` as a registered rating participant. Open game → check Rated → confirm board locked to 19×19, max handicap slider shown, komi/color absent. Submit and confirm game created as 19×19 ranked open.
3. As registered participant: Direct challenge → check Rated → select opponent → confirm derived handicap/komi/color shown as disabled preview. Submit and confirm challenge created with derived settings.
4. As registered participant: Direct challenge → uncheck Rated → select any opponent → confirm all settings editable. Submit and confirm unranked challenge created.
5. Email invite variant: confirm Rated disabled and unchecked, email input visible. Submit with email and optional message. Confirm invite-only unranked game created.
6. Create rated open game with max handicap 4. Join with opponent who has a 6-stone rating gap. Confirm handicap is capped at 4 (not 6).
7. Create rated open game with max handicap 0. Join with opponent who has a large rating gap. Confirm game is even (0 handicap).
