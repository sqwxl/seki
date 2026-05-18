# Feature Specification: UserLabel UserData Refactor

**Development Branch**: `main` unless explicitly requested otherwise

**Created**: 2026-05-18

**Status**: Draft

**Input**: User description: "i've started refactoring userlabel call sites to pass in UserData objects instead of plain data points. the intention is to clean up the code by providing structured data to a reusable component and to adjust rendering options per context via props. the rationale is that anytime the client application is in a context where it is rendering user-related data, it should already have access to the necessary information to pass on to as-is to reusable components"

## Source References _(mandatory)_

- README.md: user and social feature checklist, including implemented online presence and ranking, plus pending rich user labels.
- FRONTEND_SPEC.md: "User labels and identity display" defines the common display structure and context-specific visibility for stone, presence, rank, friend, and bot indicators.
- FRONTEND_SPEC.md: "User-search behavior" requires search results to use full user-label presentation minus the stone icon.
- FRONTEND_SPEC.md: chat behavior requires known black/white players to render with colored stone labels and presence-aware user labels.

## Clarifications

### Session 2026-05-18

- Q: When a first-party screen only has user primitives available, should the refactor update the screen data contract or allow call-site adaptation? -> A: Update first-party screen data contracts to provide complete user data for labels.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Consistent User Labels (Priority: P1)

As a player or spectator, I want user identity labels to look consistent wherever the same user appears, so I can recognize players, opponents, chat participants, and search results without learning different presentation rules per screen.

**Why this priority**: User labels are a cross-application identity surface. Inconsistent labels make presence, rank, and player color harder to understand.

**Independent Test**: Can be tested by viewing the same known user in player panels, game lists, chat, profile-related surfaces, and challenge search, then confirming the shared identity parts remain consistent while each context shows only the expected optional indicators.

**Acceptance Scenarios**:

1. **Given** a registered ranked user is displayed in multiple user-related contexts, **When** each label is rendered, **Then** the display name and rank information are sourced from the same user data and appear consistently where that context allows rank display.
2. **Given** a user has an online or away presence state, **When** the user is displayed outside the document title, **Then** the presence indicator appears consistently according to the label rules.
3. **Given** a user is displayed in a context that should not show a stone icon, **When** the label is rendered, **Then** identity details remain available while the stone icon is omitted for that context.

---

### User Story 2 - Context-Specific Label Options (Priority: P2)

As a user moving through different screens, I want labels to adapt to each context without losing identity details, so a chat sender, game-list player, search result, and profile heading each show the right amount of information.

**Why this priority**: The same reusable label must support different display rules without forcing each screen to rebuild user identity data by hand.

**Independent Test**: Can be tested by configuring representative label contexts and confirming each one includes or excludes stone, rank, presence, friend, and bot indicators according to the frontend specification.

**Acceptance Scenarios**:

1. **Given** a user appears in challenge-user selection, **When** the label is rendered, **Then** it shows the full user-label presentation except for the stone icon.
2. **Given** a known player appears in chat, **When** the label is rendered, **Then** it can show the player's stone color and presence-aware identity information.
3. **Given** a user appears in the browser document title or another compact context, **When** optional indicators are disabled, **Then** the rendered label remains readable and does not expose hidden-context indicators.

---

### User Story 3 - Complete User Data Flow (Priority: P3)

As a maintainer, I want user-related screens to pass complete user data objects into the shared label component, so future identity features can be added in one place without repeatedly expanding individual call sites.

**Why this priority**: This supports maintainability and future rich-label work while preserving current behavior.

**Independent Test**: Can be tested by inspecting all user-label call sites and verifying they provide the available structured user data object directly, with context-specific rendering controlled by explicit label options.

**Acceptance Scenarios**:

1. **Given** a screen has access to user-related data for a displayed user, **When** it renders the shared label, **Then** it passes the structured user data rather than manually splitting the user into separate display-name, rank, and presence values.
2. **Given** a screen only has partial user data because the user is not yet loaded or is absent, **When** the label is rendered, **Then** the screen uses an explicit fallback state rather than fabricating incomplete user details.

### Edge Cases

- A player slot, chat sender, or search result may be missing because the user has not loaded yet; the label should show a clear fallback without implying incorrect identity details.
- Anonymous users should render like regular users except without a rank qualifier.
- Unregistered, non-participating, unranked, ranked, friend, and bot states must not require separate one-off label implementations.
- Game-specific rank display should remain stable when the context represents historical or game-bound rank, rather than silently substituting an unrelated current rank.
- Contexts that intentionally hide an indicator must still preserve enough user data for other allowed indicators and accessible labeling.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: User-related client screens MUST provide the shared user label with the structured user data already available for the displayed user when such data exists.
- **FR-002**: The shared user label MUST derive display name, registration state, rank qualifier, bot state, and other identity indicators from the provided user data instead of requiring each caller to pass separate primitive values for those fields.
- **FR-003**: The shared user label MUST accept explicit context options that control whether stone, presence, rank, friend, bot, profile-link, and compact-display affordances are shown.
- **FR-004**: Context options MUST preserve the frontend-specified label behavior for player panels, game lists, chat sender labels, game user lists, user profiles, challenge-user selection, and document-title-like compact contexts.
- **FR-005**: The system MUST keep existing user-facing label text and indicator semantics unchanged except where the context options intentionally include or omit existing indicators.
- **FR-006**: User-label call sites MUST use explicit fallback states when the user data is absent or still loading, rather than constructing partial user-like data from unrelated plain values.
- **FR-007**: Labels for anonymous users MUST omit rank qualifiers while still supporting display name, profile navigation, and presence display when available.
- **FR-008**: Labels for game-bound contexts MUST be able to show rank or identity details appropriate to that game context when those details differ from current profile state.
- **FR-009**: The feature MUST not require new user profile capabilities, new social relationships.
- **FR-010**: If a first-party screen currently receives only primitive user fields for a real displayed user, the relevant screen data contract MUST be updated to provide complete user data for label rendering instead of adapting those primitives at each label call site.

### Contract and Boundary Requirements _(include when applicable)_

- **CB-001**: First-party client data for screens that render users MUST include enough structured user data to support the user-label presentation required by that screen.
- **CB-002**: Browser routes and first-party data endpoints that already provide user information must preserve their existing user-visible behavior while enabling direct reuse of that structured user data by label consumers.
- **CB-003**: Label rendering is a client presentation concern; server-side authorization, visibility filtering, and game access behavior remain unchanged.

### Key Entities _(include if feature involves data)_

- **User Data**: The structured representation of a displayed user, including identity and optional display metadata such as display name, registration state, rank, presence-relevant identity, friend or bot indicators when available, and profile navigation identity.
- **User Label Context Options**: The set of rendering choices for a label instance, including whether to show stone, rank, presence, friend, bot, link, and compact variants.
- **User Label**: The reusable identity display element that combines user data and context options into a consistent visible label.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: 100% of shared user-label usages that have access to structured user data pass that structured data directly rather than separate display-name, rank, or presence primitives.
- **SC-002**: Representative user-label contexts for player panels, game lists, chat, user search, and profile display match the documented indicator visibility rules in manual or automated checks.
- **SC-003**: No existing user-facing flow that displays player or user identity loses display name, presence, rank, or profile navigation behavior after the refactor.
- **SC-004**: Adding a new supported identity indicator can be validated by changing the shared label behavior and updating context options, without requiring every existing user-label caller to provide a new standalone primitive.

## Assumptions

- The refactor is scoped to user-label data flow and presentation consistency, not to adding the full pending rich-label feature set.
- Current backend and first-party screen data are expected to contain the required user information for contexts that render user-related data; any primitive-only gaps in first-party data should be addressed at the screen data contract before completing the label refactor.
- Existing labels may continue to use fallbacks for loading, empty player slots, or system messages where there is no real user to render.
- Development remains on `main` per project policy.
