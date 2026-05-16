# Data Model: Ranked Game Form Redesign

## Entity Changes

### Game (existing, extended)

New nullable column appended to the `games` table:

**Field**: `max_handicap INTEGER`

- **Purpose**: The maximum number of handicap stones the creator is willing to accept in a rated open game.
- **Null**: When the game is unrated, an email invite, or a direct challenge.
- **Non-null**: Only for rated open games. Populated at creation from the form's max handicap slider (range 0–9).
- **Enforcement**: When an opponent joins a rated open game, `game_joiner` derives the handicap from the rating gap via the calibration policy, then caps it at `max_handicap`. If `max_handicap = 0`, the game is always even.

**Validation Rules**:

- Must be between 0 and 9 inclusive when non-null (max handicap for 19×19 board).
- Must be NULL for non-rated games, email invites, and direct challenges.
- Does not affect komi or color derivation — only handicaps are capped.

### Game Creation Variant (frontend only)

**States**: `open` | `challenge` | `email`

**Transition**: User selects via radio buttons on the form. Switching resets settings to the new variant's defaults.

### Rated Settings Preview (frontend only)

Computed client-side when a direct challenge opponent is selected.

**Fields** (derived from rating gap):
- `handicap`: handicap stones (0–9)
- `komi`: 6.5 (even) or 0.5 (handicap)
- `color_reason`: "lower_rating_black" or "exact_rating_random"

**Source**: `RatingCalibrationPolicy::ranked_settings(black_rating, white_rating)` — already implemented in `seki-web/src/services/rating.rs`, mirrored in `seki-web/frontend/src/utils/rating.ts`.

## Migration

A new migration `003_max_handicap.sql` adds the column:

```sql
ALTER TABLE games ADD COLUMN max_handicap INTEGER;
```

No other schema changes are needed. Existing rows default to NULL (meaning no max handicap constraint — equivalent to unrated game behaviour, which is correct for all existing games).

## NewGameData DTO Extension

The `NewGameData` struct (returned by `/api/web/games/new`) gains optional fields:

```json
{
  "eligible_opponents": [
    { "id": 1, "username": "player1", "rank": { ... } },
    { "id": 2, "username": "player2", "rank": { ... } }
  ]
}
```

- `eligible_opponents`: Present when the user is registered and creating a direct challenge. Filtered to exclude anonymous, unregistered, and non-participating users when the current user is creating a rated game.
