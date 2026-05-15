# Feature Specification: Player Rating System

**Development Branch**: `main` unless explicitly requested otherwise

**Created**: 2026-05-15

**Status**: Draft

**Input**: User description: "player rating system"

## Clarifications

### Session 2026-05-15

- Q: Which game settings should be eligible for ranked games beyond privacy and user eligibility? → A: Ranked games use automatic handicap, komi, and color settings derived from rating gap; users cannot manually set handicap or komi for ranked games.
- Q: How should color be assigned when ranked players have the same kyu/dan label or exact rating tie? → A: Lower Glicko-2 rating gets Black; exact rating ties use random color assignment. Ranked game creation and pre-game contexts always show each player's numeric rating so this assignment is explainable even when the global display preference is kyu/dan.
- Q: Which rating algorithm should Seki use? → A: Use Glicko-2 via the zero-default-dependency `skillratings` crate.
- Q: How should rating uncertainty be represented? → A: Persist Glicko-2 rating deviation and volatility. Append `?` to displayed ratings while deviation is above the provisional threshold.
- Q: When should Glicko-2 updates be applied? → A: Apply Glicko-2 immediately after each completed ranked game rather than batching results into rating periods.
- Q: What rating deviation threshold marks a rating as uncertain? → A: Append `?` while rating deviation is greater than 110.
- Q: How should numeric ratings map to kyu/dan ranks and handicap steps before bot calibration exists? → A: Use a configurable, versioned rating-to-rank calibration policy. The first implementation may ship a provisional default mapping, but stored rating state remains numeric Glicko-2 data and must not be rewritten when calibration changes.

## Source References *(mandatory)*

- README.md Features > Auth & Accounts: unchecked "Ranking system (ELO, kyu/dan)" and "Ranked/unranked game option"
- README.md Features > Auth & Accounts: unchecked "Rich user labels (rank/friend/bot indicators)"
- README.md Features > Real-time: unchecked "Filter games list (unranked, rank range, time, size)"
- FRONTEND_SPEC.md > Guest and session identity behavior: guest users may not participate in ranked games
- FRONTEND_SPEC.md > User labels and identity display: rank qualifier rules, visibility, and game-bound rank semantics
- FRONTEND_SPEC.md > Ranking and rated-game behavior: ranked status is chosen at creation time, private games cannot be ranked, spectators do not affect rating
- FRONTEND_SPEC.md > Game creation, challenge, and join constraints: ranked games are restricted to registered users and valid only for direct challenges or open games
- FRONTEND_SPEC.md > `/games`, `/games/new`, and `/users/:username`: game-list, creation-form, and profile contexts that must display rating status and rank qualifiers
- API_SPEC.md > Access Control: protected game details and histories must not leak through direct API or websocket access

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Play Ranked Games (Priority: P1)

A registered player can create or accept a ranked game, complete it normally, and see both players' Glicko-2 ratings and public ranks update from the result.

**Why this priority**: This is the core value of the feature; without reliable rated results, rank labels and filtering are only cosmetic.

**Independent Test**: Can be fully tested by having two registered users opt into ranking, play a ranked game to resignation, and verify that the winner's rating increases, the loser's rating decreases, both uncertainty values update, and the completed game remains marked as ranked.

**Acceptance Scenarios**:

1. **Given** two registered rating participants with established ratings, **When** they complete a ranked game by resignation, **Then** both Glicko-2 ratings are recalculated from the game result and their current rank qualifiers reflect the new ratings.
2. **Given** a registered user creates a ranked open game, **When** another registered rating participant joins it, **Then** the game starts as ranked and keeps that status for its lifetime.
3. **Given** a registered user creates a ranked game, **When** the rated opponent is known, **Then** handicap, komi, and color settings are automatically derived from the player rating gap and current rating-to-rank calibration policy rather than manually chosen by either player.
4. **Given** two ranked players have the same kyu/dan label but different numeric ratings, **When** their ranked game settings are derived, **Then** the lower-rated player receives Black.
5. **Given** two ranked players have exactly the same numeric rating, **When** their ranked game settings are derived, **Then** color is assigned randomly.
6. **Given** a user is creating or reviewing a pre-game ranked matchup, **When** the global rating display preference is kyu/dan, **Then** each player's numeric rating is still visible in that game-creation or pre-game context.
7. **Given** a ranked game has already been created, **When** spectators join, leave, or reconnect, **Then** the game's ranked status and rating eligibility do not change.

---

### User Story 2 - Understand Rank Everywhere (Priority: P2)

Players and spectators can recognize each registered player's ranking status from shared user labels on profiles, game lists, player panels, game-info popovers, and challenge selection. They can choose whether ratings are primarily shown as kyu/dan or numeric rating.

**Why this priority**: A rating system needs visible, consistent meaning in the places where users choose opponents and interpret game strength.

**Independent Test**: Can be tested by viewing ranked, uncertain/provisional, unranked, non-participating, anonymous, and bot users across profile, game list, player panel, and challenge UI contexts.

**Acceptance Scenarios**:

1. **Given** a registered user has a rating deviation of 110 or lower, **When** their label appears in a supported context, **Then** the label includes their current rank qualifier without `?`.
2. **Given** a registered user has a rating deviation greater than 110, **When** their label appears in a supported context, **Then** the label includes their current rank qualifier with `?`.
3. **Given** a registered user has no rated results yet, **When** their label appears, **Then** the label uses the unranked qualifier.
4. **Given** an anonymous user appears in the same contexts, **When** their label is rendered, **Then** no rank qualifier is shown.
5. **Given** a completed game's history row is viewed later, **When** the players' current ranks have changed since the game began, **Then** the game-bound rank qualifiers still reflect the ratings captured for that game context.
6. **Given** a user selects numeric rating as their global rating display preference, **When** compact ranked labels are shown, **Then** numeric rating is the primary visible value and the corresponding kyu/dan value is available on hover or equivalent accessible disclosure.
7. **Given** a user keeps the default rating display preference, **When** compact ranked labels are shown, **Then** kyu/dan is the primary visible value and the corresponding numeric rating is available on hover or equivalent accessible disclosure.

---

### User Story 3 - Choose Rating Participation (Priority: P3)

A registered user can understand whether they are participating in ranking, opt in or out of future rated play, and avoid accidental rated games.

**Why this priority**: Rating participation affects user trust and social expectations; users need control and clear constraints before playing.

**Independent Test**: Can be tested by toggling rating participation on a registered account and verifying ranked-game availability, user-label qualifier, and profile/settings copy update accordingly.

**Acceptance Scenarios**:

1. **Given** a registered user has opted out of ranking, **When** they view their own profile or settings, **Then** they see that future ranked games are unavailable until they opt back in.
2. **Given** a user is not participating in ranking, **When** their label appears, **Then** it shows the non-participating rank qualifier.
3. **Given** a user opts out while ranked games are already in progress, **When** those games finish, **Then** their rating treatment follows the eligibility captured when each game was created or joined.

---

### User Story 4 - Preserve Rating History (Priority: P4)

A player can rely on their rating history being preserved over time, so future analysis features can show rating progression, rating uncertainty, rating graphs, and per-game changes.

**Why this priority**: Current rating alone is not enough for review, trust, or future analytics; every rated result needs an auditable history.

**Independent Test**: Can be tested by completing multiple ranked games, then verifying the player profile can expose each rating change in chronological order with prior rating, new rating, deviation, volatility, and game reference.

**Acceptance Scenarios**:

1. **Given** a player completes several ranked games, **When** their rating history is viewed, **Then** each rating-changing game appears in chronological order with the rating before and after the game.
2. **Given** a player changes username or temporarily opts out of future ranking, **When** their rating history is viewed later, **Then** prior rating adjustments remain attached to the same user identity.
3. **Given** a future analysis view requests rating-over-time data, **When** historical rating adjustments exist, **Then** the data is sufficient to reconstruct the player's rating progression and uncertainty without inferring it from current rating alone.

---

### User Story 5 - Find Suitable Games (Priority: P5)

A player browsing games can distinguish ranked from unrated games and filter open opportunities by rating status and opponent strength.

**Why this priority**: Discovery and matchmaking improve after the core rating workflow is reliable, but filtering is less essential than correct rating outcomes.

**Independent Test**: Can be tested by populating the games list with open ranked and unrated games across several rank ranges, then applying filters and verifying only matching games remain visible.

**Acceptance Scenarios**:

1. **Given** open games include both ranked and unrated games, **When** the games list is displayed, **Then** unrated games are visibly marked and ranked games show player rank qualifiers when available.
2. **Given** a user applies a rank-range filter, **When** matching open ranked games exist, **Then** only games whose available opponent context falls within the selected range are shown.

### Edge Cases

- Aborted, declined, cancelled, or otherwise unplayed games must not change ratings.
- Private games must never change ratings, even if both players are registered and opted into ranking.
- Invite-only and direct-challenge games follow the ranking eligibility rules captured at creation time.
- A timeout, resignation, or agreed score counts as a rated result when the game is ranked and both players were eligible.
- Score estimates, local analysis outcomes, undone moves, and alternate review branches must not affect ratings.
- Rating updates must be applied at most once per completed ranked game, including after reloads, reconnects, and server restarts.
- Rating updates are applied immediately when each ranked game reaches a rated terminal result; there is no daily or manual rating-period batch in the first version.
- Rating history must preserve every applied rating adjustment and must not collapse older adjustments into only the current rating.
- Rating uncertainty must be preserved with each current rating and rating-history entry.
- Username changes must not break rating history or profile access to prior rated games.
- Bots may participate in ranked games and use the same visible rank semantics as registered users.
- Anonymous users, guests, and users who have not registered must not join or create ranked games.
- Protected game visibility must continue to obey existing privacy and invite authorization rules when rating data is shown in history contexts.
- Rating display preference changes must affect only presentation and must not change stored rating values or rating calculations.
- Ranked games must not allow manual handicap or komi settings; those values are derived from the participants' rating gap when the rated opponent is known.
- Kyu/dan labels and handicap-step counts must be derived from the active rating-to-rank calibration policy and must not require rewriting stored Glicko-2 ratings or rating history when the policy changes.
- Ranked color assignment uses Glicko-2 rating as the tiebreaker within the same kyu/dan label: lower rating receives Black, and exact rating ties use random color assignment.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST let registered users participate in ranking and clearly distinguish ranked, uncertain/provisional, unranked, and non-participating registered users in visible labels.
- **FR-002**: The system MUST prevent anonymous, guest, or otherwise unregistered users from creating, joining, or accepting ranked games.
- **FR-003**: The system MUST allow a ranked/unrated choice when eligible users create direct challenges or open games.
- **FR-004**: The system MUST reject ranked private games and ranked games whose participation mode is not allowed by the product rules.
- **FR-005**: The system MUST determine each game's ranked status at creation time and preserve that status for the lifetime of the game.
- **FR-006**: Ranked games MUST derive handicap, komi, and color settings from the participants' rating gap and active rating-to-rank calibration policy, and MUST NOT allow users to manually set handicap or komi.
- **FR-007**: For ranked color assignment, the system MUST assign Black to the lower-rated player and use random color assignment only when both players have exactly equal numeric rating.
- **FR-008**: Ranked game creation and pre-game contexts MUST show each player's numeric rating even when the user's global rating display preference is kyu/dan.
- **FR-009**: The system MUST calculate rating changes with Glicko-2 using the `skillratings` crate with default features only unless a later plan explicitly justifies optional features.
- **FR-010**: The system MUST persist each participant's Glicko-2 rating, rating deviation, and volatility as the authoritative rating state.
- **FR-011**: The system MUST mark displayed ratings as uncertain by appending `?` while rating deviation is greater than 110.
- **FR-012**: The system MUST capture the relevant player rating values for each ranked or rank-displaying game context so historical game rows remain stable even if current ratings later change.
- **FR-013**: The system MUST update player ratings immediately and exactly once when an eligible ranked game reaches a rated terminal result.
- **FR-014**: The first version MUST NOT require daily, manual, or otherwise delayed rating-period batch processing for completed ranked games.
- **FR-015**: The system MUST preserve a chronological rating history for each player, including every applied rating adjustment rather than only the current rating.
- **FR-016**: Each rating-history entry MUST include enough user-facing information to explain the change, including the related game, result, rating before/after, rating deviation before/after, volatility before/after, and when the adjustment occurred.
- **FR-017**: The system MUST avoid rating changes for unrated games, private games, aborted games, declined games, unplayed games, estimates, analysis-only outcomes, and spectator activity.
- **FR-018**: The system MUST display rank qualifiers using the existing product meanings: `(?)` for registered users without rated results, `(-)` for registered users not participating in ranking, and the player's derived rank or numeric rating for ranked registered users, with `?` appended while the rating remains uncertain.
- **FR-019**: The system MUST show rank qualifiers in game-info popovers, player panels, game lists, player profile titles, and challenge-user selection.
- **FR-020**: Users MUST be able to choose a global rating display preference between kyu/dan and numeric rating, with kyu/dan as the default.
- **FR-021**: Compact ranked labels SHOULD expose the corresponding value from the alternate rating display system on hover or equivalent accessible disclosure.
- **FR-022**: The system MUST show unrated status in the game-info popover and append `(unrated)` to unrated game descriptions in game lists.
- **FR-023**: The system MUST allow users browsing games to filter by rated/unrated status and by a practical rank range for available opponents.
- **FR-024**: The system MUST show a player's current rating/rank summary and rated-game history on their profile when the viewer is authorized to see the relevant games.
- **FR-025**: The system MUST keep rating history attached to the user identity across username changes and registration upgrades from anonymous sessions.
- **FR-026**: The system MUST provide user-facing feedback when a ranked-game action is unavailable because of registration, participation, privacy, or opponent eligibility rules.
- **FR-027**: The system MUST handle bot users as eligible ranked participants while preserving bot-specific social restrictions.
- **FR-028**: The system MUST derive kyu/dan labels and handicap-step counts through a configurable, versioned rating-to-rank calibration policy; the first implementation MAY use a provisional default mapping, but calibration changes MUST NOT mutate stored Glicko-2 ratings or rating-history entries.

### Contract and Boundary Requirements *(include when applicable)*

- **CB-001**: Rating eligibility, ranked-game creation constraints, rated-result processing, and protected-game visibility MUST be enforced even when browser clients are bypassed.
- **CB-002**: Web route data for games, game creation, user profiles, and challenge selection MUST include enough rating and rank-label information for the browser to render the required states without guessing.
- **CB-003**: Realtime game and lobby updates MUST include rating-status or rank-label changes when those changes affect currently visible games or user labels.
- **CB-004**: Public game lists and public profile histories MUST continue to hide private or invite-protected games from unauthorized viewers, including any rating metadata attached to those games.
- **CB-005**: Rating calculations and rating history belong to the web application domain and MUST NOT change Go rules, scoring, SGF parsing, or board-state behavior.

### Key Entities *(include if feature involves data)*

- **Rating Profile**: The ranking state for a registered or bot user, including participation status, Glicko-2 rating, rating deviation, volatility, uncertainty state, derived rank qualifier, and summary counts.
- **Rated Game Snapshot**: The rating-relevant facts captured for each eligible game, including ranked status, player identities, automatically derived game settings, game-bound rating values, result category, and whether rating updates have been applied.
- **Rating Adjustment**: A durable history record of a completed rated result's effect on each participant, including prior/new rating, prior/new deviation, prior/new volatility, opponent context, result, adjustment time, and game reference.
- **Rank Qualifier**: The user-facing label derived from rating participation, rating strength, display preference, and uncertainty state.
- **Rating Display Preference**: The user's global presentation choice for showing ratings primarily as kyu/dan or numeric rating; it changes display only and does not affect rating calculations.
- **Rating-to-Rank Calibration Policy**: The versioned presentation policy that maps numeric Glicko-2 ratings to kyu/dan labels and handicap-step differences without changing the underlying stored rating state.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of completed eligible ranked games update both player ratings exactly once in verification runs that include reload, reconnect, and restart scenarios.
- **SC-002**: 0 unrated, private, aborted, declined, unplayed, estimate-only, or spectator-only events change a player's rating in validation scenarios.
- **SC-003**: 100% of applied rating updates create a corresponding historical adjustment entry with enough information to reconstruct each player's rating progression and uncertainty.
- **SC-004**: A registered user can create a ranked open game or direct challenge in under 30 seconds when all eligibility requirements are met.
- **SC-005**: 95% of users in usability checks can correctly identify whether a visible game is ranked or unrated and whether a visible player is ranked, uncertain, unranked, or not participating.
- **SC-006**: 95% of users in usability checks can switch between numeric rating and kyu/dan display and identify the alternate value from a compact rank label.
- **SC-007**: Game-list filtering by rated status and rank range returns matching visible games within 1 second for typical lobby sizes.
- **SC-008**: Existing authorized profile and game-history visibility rules remain unchanged for private and invite-protected games in access-control tests.

## Assumptions

- The first version uses Glicko-2 through `skillratings` with default features only.
- The first version applies Glicko-2 as immediate per-game updates, not as scheduled rating periods.
- Initial rating values follow Glicko-2 defaults unless implementation planning identifies a project-specific reason to tune them.
- Rating uncertainty is derived from Glicko-2 rating deviation; the first implementation appends `?` while rating deviation is greater than 110.
- Kyu/dan display rank is derived from the Glicko-2 numeric rating value through a configurable, versioned calibration policy.
- Registered users participate in ranking by default after registration unless they explicitly opt out before entering ranked games.
- Users without rated results are shown as unranked until they complete at least one rated game.
- Ranked-game eligibility is evaluated when the game is created and, for open games, when the second player joins.
- Ranked game settings are finalized from the participants' rating gap and active rating-to-rank calibration policy when both rated players are known.
- Known-strength bot calibration is expected to improve the rating-to-rank policy later, but bot calibration itself is outside the first version.
- Numeric rating is shown in ranked game creation and pre-game contexts because it explains automatic color assignment when players share the same kyu/dan display rank.
- Existing game result categories remain authoritative for deciding whether a game completed normally.
- Rating history is visible only through already-authorized game and profile contexts; this feature does not create a separate public leaderboard in its first version.
- Rating history is retained as first-class product data so later analysis features can render rating graphs without replaying all historical games.
- The default frontend rating display is kyu/dan because it is the Go-native presentation; numeric rating remains available as a global display preference.
- The rating system covers two-player games only.
