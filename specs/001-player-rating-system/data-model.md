# Data Model: Player Rating System

## Entity: Rating Profile

Represents a user's current ranking state.

**Fields**:
- `user_id`: identity this rating profile belongs to
- `participating`: whether the user may enter future ranked games
- `rating`: current Glicko-2 rating used for calculation and persisted as the server source of truth
- `deviation`: current Glicko-2 rating deviation used as the rating uncertainty signal
- `volatility`: current Glicko-2 volatility
- `rated_games`: count of rated games applied to this profile
- `created_at`, `updated_at`: audit timestamps

**Relationships**:
- One rating profile belongs to one user.
- One rating profile has many rating adjustments.

**Validation Rules**:
- Only registered users and bot users may participate in ranking.
- Anonymous or guest users have no rank qualifier and cannot create/join ranked games.
- Non-participating registered users show `(-)` and cannot enter new ranked games.
- Users with no rated results show `(?)`.
- Users whose deviation is above the provisional threshold append `?` to their displayed kyu/dan or numeric rating.
- Kyu/dan rank labels are derived from persisted rating values through the active rating-to-rank calibration policy and are not stored as rating state.

## Entity: Rated Game Snapshot

Represents rating-relevant state captured for a game.

**Fields**:
- `game_id`: rated game reference
- `ranked`: whether the game is rated
- `rating_applied`: whether rating adjustment rows have already been written
- `black_user_id`, `white_user_id`: rated participants when both seats are known
- `black_rating_before`, `white_rating_before`: game-bound rating snapshots used for stable historical presentation
- `black_deviation_before`, `white_deviation_before`: game-bound uncertainty snapshots
- `black_volatility_before`, `white_volatility_before`: game-bound volatility snapshots
- `derived_handicap`: handicap derived for the ranked game
- `derived_komi`: komi derived for the ranked game
- `derived_color_reason`: short reason for automatic color assignment, such as lower rating or exact rating tie
- `calibration_policy_version`: rating-to-rank calibration policy version used to derive handicap-step presentation for this snapshot
- `result`: terminal result used for rating, when available
- `created_at`, `updated_at`: audit timestamps

**Relationships**:
- One rated game snapshot belongs to one game.
- One rated game snapshot produces two rating adjustments when applied.

**Validation Rules**:
- Private games cannot be ranked.
- Ranked games must be open or direct challenges.
- Ranked games require registered or bot participants.
- Ranked status is immutable after creation.
- Ranked games do not accept manual handicap or komi.
- Open ranked games become fully eligible only when the second registered/ranking participant joins.
- Ranked handicap, komi, and color are finalized from numeric rating context and the active calibration policy when both rated players are known.
- Lower rating receives Black; exact rating ties use random color assignment.
- Game-bound kyu/dan labels are derived from stored game-bound rating snapshots, not persisted separately.

## Entity: Rating Adjustment

Durable history record for one participant's rating change from one rated game.

**Fields**:
- `id`: adjustment identity
- `user_id`: participant whose rating changed
- `game_id`: game that caused the adjustment
- `opponent_id`: opponent in that game
- `result`: terminal game result
- `rating_before`, `rating_after`: participant rating before and after applying the game
- `deviation_before`, `deviation_after`: participant rating deviation before and after applying the game
- `volatility_before`, `volatility_after`: participant volatility before and after applying the game
- `rating_delta`: signed difference between after and before
- `opponent_rating_before`: opponent rating at calculation time
- `created_at`: adjustment timestamp

**Relationships**:
- Many rating adjustments belong to one rating profile.
- Two rating adjustments belong to one completed rated game, one per participant.

**Validation Rules**:
- A user may have at most one adjustment per game.
- A rated game may create adjustments only once.
- Adjustments are append-only product history; they are not rewritten for username changes or opt-out changes.
- Adjustment rows store Glicko-2 values only; rank labels for history displays are derived from those values.
- Rating-to-rank calibration changes must not rewrite adjustment rows.

## Entity: Rank Qualifier

User-facing label derived from rating state.

**Source of Truth**:
- Rank qualifiers are presentation values derived from the current or game-bound rating plus participation/deviation state.
- The server persists rating, deviation, volatility, and participation state; it does not persist kyu/dan labels as rating state.

**States**:
- No qualifier: anonymous or guest user
- `(-)`: registered user not participating in ranking
- `(?)`: registered participating user without rated results
- `(<rank>?)` or `(<rating>?)`: participating user whose deviation is above the provisional threshold
- `(<rank>)` or `(<rating>)`: participating user whose deviation is at or below the provisional threshold

**Validation Rules**:
- Current contexts use the user's current rating profile.
- Game-bound contexts use stored game snapshots and the appropriate calibration policy version for that context.
- Rank labels must not reveal protected game participation to unauthorized viewers.

## Entity: Rating-to-Rank Calibration Policy

Presentation policy that maps numeric Glicko-2 ratings to kyu/dan labels and handicap-step differences.

**Fields**:
- `version`: stable policy version identifier
- `default`: whether this is the active default policy
- `rank_boundaries`: ordered rating boundaries for kyu/dan labels
- `handicap_step_boundaries`: ordered rating-gap boundaries for handicap-step counts
- `created_at`: audit timestamp

**Relationships**:
- Rated game snapshots record the policy version used when ranked settings are derived.
- Current rank qualifiers use the active default policy.

**Validation Rules**:
- Calibration policy changes are presentation and game-setting policy changes; they do not mutate stored Glicko-2 ratings, deviation, volatility, or rating adjustment history.
- The first implementation may represent the default policy in code or configuration, but it must have a stable version value in DTOs/snapshots where historical interpretation matters.
- Known-strength bot calibration can introduce a later policy version, but bot calibration is out of scope for the first implementation.

## Entity: Rating Display Preference

Represents how the frontend primarily displays ratings.

**Fields**:
- `mode`: either `kyu_dan` or `rating`

**Defaults**:
- `kyu_dan`

**Relationships**:
- Belongs to the current user's preference set.
- Applies globally across user labels, game lists, player panels, profiles, game-info popovers, and challenge selection.

**Validation Rules**:
- The preference changes presentation only.
- Glicko-2 rating remains the persisted server source of truth regardless of selected display mode.
- Compact rank labels expose the corresponding alternate display value on hover or equivalent accessible disclosure when a ranked value exists.
- Ranked game creation and pre-game contexts always show numeric rating for both players even when this preference is `kyu_dan`.

## State Transitions

### Rating Profile

```text
registered default -> participating without rated results
first rated result -> participating with uncertain rating
deviation drops to threshold -> participating with established rating
participating established -> non-participating when user opts out
non-participating -> participating with prior rating/history preserved when user opts back in
```

### Rating Display Preference

```text
default kyu_dan -> rating when user selects numeric rating display
rating -> kyu_dan when user selects kyu/dan display
```

### Rated Game Snapshot

```text
unranked game -> never rated
ranked game created -> waiting for both eligible seats
both eligible seats assigned -> automatic settings, calibration policy version, and rating snapshots captured
rated terminal result -> rating_applied with two adjustment rows
aborted/declined/unplayed/private/unrated terminal result -> no rating adjustment
```
