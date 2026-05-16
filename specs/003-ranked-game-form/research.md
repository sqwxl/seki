# Research: Ranked Game Form Redesign

## Decision: Split monolithic form into variant modules

**Rationale**: The existing `game-settings-form.tsx` is 769 lines and mixes open-game, direct-challenge, and email-invite form logic in one component. The redesign adds variant-specific gating (rated/unrated toggles, derived settings preview, opponent filtering) that would make the file unmanageable. Splitting into an orchestrator plus three variant modules keeps each file under 500 lines.

**Alternatives considered**:
- Keep one file with conditional blocks: simpler diff, but the file would exceed 1000 lines and become hard to reason about.
- Use a single component with props to control variant behaviour: fewer files, but forces variant-specific concerns into a single render function with deeply nested conditionals.

## Decision: Store `max_handicap` as a nullable column on `games`

**Rationale**: The `max_handicap` constraint is a game-level property set at creation time. Storing it on the `games` table keeps it colocated with other game settings. The column is NULL for unrated games and email invites, non-NULL only for rated open games.

**Alternatives considered**:
- Store in `rating_profiles` or a separate settings table: adds unnecessary indirection for a single value.
- Always derive max handicap from the creator's rating profile: the creator's preference for maximum handicap gap is a separate concept from their own rating.
- Store as a JSON blob in `games`: type-safe column is simpler for a single integer value.

## Decision: Compute derived settings preview in the frontend

**Rationale**: When a rated direct challenge opponent is selected, the form should show the derived handicap, komi, and color as read-only preview values. The frontend already has the calibration policy logic in `utils/rating.ts` (via `RatingCalibrationPolicy`). Computing the preview client-side avoids an extra API call per opponent selection and keeps the DTOs simple.

**Alternatives considered**:
- Backend returns preview values in the NewGameData DTO: more authoritative, but requires an API call on each opponent selection and couples the form DTO to a specific opponent lookup.
- No preview at all: the simplest, but the spec requires read-only preview fields so the creator can see what settings will be used.

## Decision: Extend `/api/web/games/new` with variant-specific fields

**Rationale**: The frontend needs to know the user's rating eligibility, the opponent list for direct challenges, and any rated availability constraints. These already exist partially in `NewGameData` (via `can_create_ranked`, `ranked_unavailable_reason`). Adding an `eligible_opponents` list and a `variant` field keeps the DTO backward-compatible while providing the new form with what it needs.

**Alternatives considered**:
- Separate endpoints per variant: adds route complexity without benefit.
- Return all data unconditionally: simpler DTO, but returns unnecessary data for the current variant.

## Decision: No new migration required if `max_handicap` fits existing schema

**Rationale**: The `games` table already has several nullable integer columns (`derived_handicap`, etc.). `max_handicap` follows the same pattern. A new migration adds the column with `ALTER TABLE games ADD COLUMN max_handicap INTEGER`.

**Alternatives considered**:
- Reuse an existing column: semantically wrong and reduces clarity.
- Skip storage and re-derive from creator preference on join: fragile — the creator's preference at join time might differ from creation time.
