# Feature Specification: Ranked Game Form Redesign

**Development Branch**: `main` unless explicitly requested otherwise

**Created**: 2026-05-16

**Status**: Draft

**Input**: User description: "The new game form needs work now that a rating system is in place. Most glaring issue is that rank distance between rated players should dictate handicap, komi and color. Currently, when creating an open ranked game, the handicap, komi and color are baked according to form choices, rather than inferred when an opponent joins. Likewise for direct challenges, the form settings are misleading, since the actual values will be populated when the game is created, regardless."

## Source References

- README.md: "Ranked/unranked game option" checklist item (complete)
- FRONTEND_SPEC.md: "Game creation, challenge, and join constraints" section
- API_SPEC.md: "Ranked Games and Rating" section
- specs/001-player-rating-system/spec.md: Player Rating System feature spec

## User Scenarios & Testing

### User Story 1 - Create an Open Ranked Game (Priority: P1)

A registered rating participant wants to create an open game where anyone registered can join, and the game should be rated. The creator selects "Open game", checks "Rated", and sees only the relevant settings: a fixed 19×19 board, a handicap slider for the maximum allowed rank-distance handicap, and a takebacks toggle. Komi, color, and the actual handicap are not set on the form — they will be derived from the two players' ratings when an opponent joins. The creator sets a time control and submits.

**Why this priority**: This is the primary ranked play path and the core motivation for the redesign. The current form misleads users by letting them set handicap/komi/color that the server silently overrides.

**Independent Test**: A registered user creates an open ranked game with max handicap 4. Another registered user joins. The resulting game is 19×19, has handicap/komi/color derived from the two players' ratings, and handicap never exceeds the creator's chosen maximum. Manual form values for komi/handicap are not submitted or are ignored.

**Acceptance Scenarios**:

1. **Given** a registered rating participant, **When** they select "Open game" and check "Rated", **Then** board size is locked to 19×19, komi field is absent, color field is absent, and a "Max handicap" slider is shown instead of a numeric handicap field.
2. **Given** a registered rating participant on the rated open game form, **When** they set max handicap to 4 and submit, **Then** a 19×19 ranked open game is created with the max-handicap constraint stored and handicap/komi/color derived when the opponent joins.
3. **Given** a registered rating participant, **When** they uncheck "Rated" on the open game form, **Then** board size, handicap, komi, and color fields become editable and the form behaves as the existing unranked game form.

---

### User Story 2 - Challenge a Ranked Opponent Directly (Priority: P1)

A registered rating participant wants to challenge a specific opponent to a rated game. They select "Direct challenge", check "Rated", and choose an opponent from a list filtered to registered rating participants. Upon selecting the opponent, the form shows the inferred handicap, komi, and color as read-only preview values (derived from the rating gap). The creator sets a time control and submits. The opponent receives a challenge with these settings.

**Why this priority**: Direct challenges are the other primary ranked play path. The current form lets the creator set misleading handicap/komi/color values that the server silently replaces.

**Independent Test**: User A (5k) challenges User B (3k) to a rated game. The form shows the derived handicap (likely 0), komi (6.5), and color (B plays Black due to lower rating) as read-only fields. The challenge is created with those settings.

**Acceptance Scenarios**:

1. **Given** a registered rating participant, **When** they select "Direct challenge" and check "Rated", **Then** the opponent list is filtered to exclude anonymous users, unregistered users, and non-participating users.
2. **Given** a registered rating participant with a rated opponent selected, **When** the opponent is chosen, **Then** handicap, komi, and color fields are displayed as disabled read-only values derived from the rating gap.
3. **Given** a registered user, **When** they uncheck "Rated" on the direct challenge form, **Then** the opponent list shows all users and all settings become editable.

---

### User Story 3 - Invite by Email (Unrated Only) (Priority: P2)

A user wants to invite someone by email to play. Email invites are never rated. The "Rated" checkbox is disabled and unchecked. The form provides email input and an optional message field alongside the standard unranked settings.

**Why this priority**: Email invites are a distinct creation mode with different constraints. The current form mixes them into the opponent selection, which is confusing especially for rated users.

**Independent Test**: A user selects "Email invite", enters an email address and an optional message, configures unranked settings, and submits. The invite is sent and the game is never ranked.

**Acceptance Scenarios**:

1. **Given** any user, **When** they select "Email invite", **Then** the "Rated" checkbox is disabled and unchecked, and the settings show the full unranked configuration (board size, handicap, komi, color, takebacks, private).
2. **Given** a user on the email invite form, **When** they submit without an email address, **Then** the form shows a validation error and does not create a game.
3. **Given** a user on the email invite form, **When** they provide an email and an optional message and submit, **Then** the game is created as invite-only, unranked, and an invitation email is queued.

---

### User Story 4 - Unranked Open Game (Priority: P3)

An unregistered or non-participating user wants to create an unranked open game. The form shows "Rated" unchecked and disabled (since they can't create rated games). All settings are editable as in the current form.

**Why this priority**: This is the existing default behaviour preserved for unregistered and non-participating users. It must remain available but requires no new logic beyond the form restructuring.

**Independent Test**: An anonymous user opens the new game form. The "Rated" checkbox is disabled and unchecked. They configure an open game with custom board size, handicap, komi, and color, and submit successfully.

**Acceptance Scenarios**:

1. **Given** an unregistered user, **When** they open the new game form, **Then** the Rated checkbox is disabled and unchecked on all variants.
2. **Given** a registered non-participating user, **When** they open the new game form, **Then** the Rated checkbox is disabled with a tooltip explaining they must opt into rating participation.

---

### Edge Cases

- What happens when a rated direct challenge is initiated but the opponent's rating changes between challenge creation and acceptance? The rating snapshots are captured at challenge creation time, so settings remain stable.
- What happens when a rated open game has a max handicap that no joining opponent would trigger? The handicap defaults to 0 and the game is even.
- What happens when a user has no rating profile yet (unranked registered user)? They cannot create rated games. The Rated checkbox is disabled.
- What happens when a rated direct challenge opponent has the exact same rating? Color is assigned randomly/nigiri-style.
- What happens when the max handicap slider is set to 0 for an open rated game? The game will be even (no handicap stones) regardless of rating difference.

## Requirements

### Functional Requirements

- **FR-001**: The new game form must present three creation variants as a first-class choice: Open game, Direct challenge, and Email invite.
- **FR-002**: Each variant must include a Rated checkbox that gates which settings are visible and editable.
- **FR-003**: For rated open games, board size must be locked to 19×19 and komi/color must be absent from the form (derived server-side when an opponent joins).
- **FR-004**: For rated open games, handicap must be replaced by a "Max handicap" control representing the maximum allowed rank-distance handicap stones.
- **FR-005**: For rated direct challenges, handicap, komi, and color must be displayed as disabled read-only fields derived from the rating gap once an opponent is selected.
- **FR-006**: For rated direct challenges, the opponent list must exclude anonymous users, unregistered users, and users who are not participating in rating.
- **FR-007**: Email invite games must never be rated. The Rated checkbox must be disabled and unchecked.
- **FR-008**: The Rated checkbox must be disabled for unregistered users and for registered users who are not participating in rating, with a tooltip explaining why.
- **FR-009**: The Rated checkbox must be disabled when the selected variant is "Email invite".
- **FR-010**: When the Rated checkbox is unchecked (unrated mode), all settings (board size, handicap, komi, color, takebacks, private toggle) must be editable.
- **FR-011**: The form must validate that an email address is provided when the Email invite variant is selected and submitted.
- **FR-012**: Server-side ranked constraints (no private ranked games, no manual handicap/komi override) must remain enforced regardless of client-side form behaviour.

### Contract and Boundary Requirements

- **CB-001**: The `/api/web/games/new` endpoint must return variant-specific data including eligibility, max handicap options, and the opponent list filtered by rating participation when applicable.
- **CB-002**: The game creation routes (`POST /games` and `POST /api/games`) must continue to reject invalid ranked combinations server-side.
- **CB-003**: This is a frontend form and DTO change. The backend game creator service must accept a `max_handicap` parameter for rated open games but derive actual handicap/komi/color from rating snapshots as before.

### Key Entities

- **Game creation variant**: One of Open game, Direct challenge, or Email invite. Determines which form fields are shown and how opponent assignment works.
- **Max handicap**: The maximum number of handicap stones the creator is willing to accept in a rated open game. Stored server-side, used to cap derived handicap when an opponent joins.
- **Rating-derived settings**: Handicap stones, komi, and color derived from the Glicko-2 rating gap between two rated players at game creation time. These replace manual settings for rated games.

## Success Criteria

### Measurable Outcomes

- **SC-001**: 100% of rated game creations result in server-derived handicap/komi/color settings, with zero cases where manual form values are inadvertently used.
- **SC-002**: Registered rating participants can create a rated open game or challenge in under 60 seconds from navigating to the form.
- **SC-003**: Users report zero confusion about why their chosen handicap/komi/color values were overridden (the form no longer presents misleading inputs).
- **SC-004**: Email invitation games are never created as rated, regardless of user misconfiguration attempts.

## Assumptions

- The existing rating calibration policy (provisional-v1) remains the source of truth for deriving kyu/dan labels and handicap-step counts.
- The backend `game_creator` service and `game_joiner` service are already capable of deriving ranked settings; this spec only changes how the frontend collects and presents those settings to the user.
- The `max_handicap` parameter for open ranked games is stored in the rated game snapshot (the existing `derived_handicap` column or a new `max_handicap` column).
- The existing time control configuration is unchanged and remains available across all variants.
- Unregistered users can still create unranked games exactly as they do today; the form restructuring does not remove any existing functionality.
