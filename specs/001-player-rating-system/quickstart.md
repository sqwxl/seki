# Quickstart: Player Rating System

## Implementation Sequence

1. Add `skillratings` to `seki-web` with default features only.
2. Add migration `seki-web/migrations/002_player_ratings.sql` for rating profiles, game rating/deviation/volatility snapshots, automatic ranked settings, calibration policy version snapshots, and rating adjustment history. Do not persist kyu/dan labels as rating state.
3. Add `seki-web/src/models/rating.rs` and register it in `models/mod.rs`.
4. Add `seki-web/src/services/rating.rs` for eligibility, Glicko-2 update calculation, rating/deviation/volatility snapshots, versioned rating-to-rank calibration, derived rank labels, uncertainty markers, automatic handicap/komi/color derivation, idempotent result application, and DTO helpers.
5. Wire ranked validation into game creation, open-game join, challenge accept/decline paths, and programmatic API game creation.
6. Disable or reject manual handicap and komi for ranked games; derive those values from numeric rating context and the active calibration policy when both rated players are known.
7. Call the rating service from all terminal result paths: resignation, agreed score/territory settlement, timeout or disconnect victory, abort/decline skip paths.
8. Extend `/api/web/*`, `/api/*`, and live update DTOs with ranked status, Glicko-2 values, derived rank-label data, uncertainty markers, and automatic ranked settings.
9. Add a global frontend rating display preference, default it to kyu/dan, and persist it through existing preference storage.
10. Update frontend user labels, game settings form, game info, player panels, game lists, profile pages, and filters. Compact ranked labels should show the alternate numeric-rating/kyu-dan value on hover or equivalent accessible disclosure, while ranked game creation and pre-game contexts always show numeric rating for both players.
11. Add focused Rust tests for rating eligibility, idempotent result application, uncertainty threshold behavior, rating history preservation, calibration-policy derivation, ranked setting derivation, and protected visibility. Add focused frontend tests for rating display formatting, preference fallback, and alternate-value disclosure where practical.
12. Update README checklist and product specs when implementation is complete.

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

## Last Verification (2026-05-16)

```text
Rust: 217 tests passed, 0 failed
  cargo test --all: ok. 217 passed; 0 failed

Frontend: 168 tests passed, 0 failed
  pnpm run typecheck: no errors
  pnpm test: 10 test files, 168 tests passed
```

## Manual Checks

1. Register two users, create a ranked open game, join it, resign after at least one move, and confirm both profiles show changed current rating plus rating/deviation/volatility history rows.
2. Repeat reload/reconnect around game completion and confirm rating adjustments are not duplicated.
3. Confirm uncertain ratings append `?` while deviation remains above the provisional threshold.
4. Try to create ranked private and ranked invite-only games; confirm the server rejects them with user-facing errors.
5. Try to submit manual handicap or komi for a ranked game; confirm the server uses or requires derived settings instead.
6. Create a same-kyu/dan ranked matchup with different numeric ratings; confirm the lower-rated player receives Black and both numeric ratings are visible in pre-game UI.
7. Create an exact-rating tie ranked matchup; confirm color assignment is random.
8. Try to join a ranked game as an anonymous user; confirm the server rejects the join.
9. View public game list, game info, player panels, challenge selection, and user profiles to confirm rank qualifiers render consistently.
10. Switch the global rating display preference between kyu/dan and numeric rating; confirm compact labels change primary value and expose the alternate value on hover or equivalent accessible disclosure.
11. Confirm private/invite-protected games and their rating metadata remain hidden from unauthorized viewers.
12. Confirm changing the provisional calibration policy in a test fixture changes derived kyu/dan/handicap-step presentation without rewriting stored rating adjustments.
