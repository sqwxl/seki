# Data Model: UserLabel UserData Refactor

## UserData

Represents a real user identity available to a first-party frontend context.

**Fields used by label rendering**:

- `id`: Stable user identifier.
- `display_name`: Visible account or anonymous-session name.
- `is_registered`: Registration state used to distinguish anonymous and registered users.
- `rank`: Optional rank metadata for contexts that show rank qualifiers.
- `preferences`: Existing current-user preferences when available; not required for every displayed user label.

**Validation rules**:

- Real displayed users should be passed as structured `UserData`, not split into separate display-name, rank, or presence primitives.
- Anonymous users may have `rank` absent or anonymous; labels must omit rank qualifiers for them.
- Missing user data means the caller is in loading, empty-slot, or system-message fallback state.

## UserLabelOptions

Represents context-specific display choices for a label instance.

**Fields**:

- `stone`: Optional player stone indicator (`black`, `white`, or hidden).
- `showPresence`: Whether a presence indicator is shown when presence state is available.
- `presence`: Optional presence state supplied by the surrounding context.
- `showRank`: Whether rank qualifier is shown.
- `rank`: Optional context-specific rank value when a game-bound or display-mode-specific rank differs from `UserData.rank`.
- `showFriend`: Whether friend or bot indicator slots are allowed in this context.
- `link`: Whether the label links to the user's profile.
- `compact`: Whether the label should suppress non-essential affordances for constrained contexts.
- `strong`: Whether the label should visually emphasize the active/current player.

**Validation rules**:

- Visibility options must be explicit at call sites or provided by a small local preset.
- Hidden indicators must not require stripping fields from `UserData`.
- Context-specific rank overrides are allowed only to preserve game-bound or display-mode semantics.

## UserLabelFallback

Represents a state where no real user identity should be rendered.

**Examples**:

- Empty player slot.
- User still loading.
- Server/system chat message.
- Unknown historical sender after visibility filtering.

**Validation rules**:

- Fallbacks must not fabricate `UserData`.
- Fallback text should be clear and consistent with existing behavior.

## Screen User Data Contract

Represents first-party screen or bootstrap data that feeds user-related views.

**Rules**:

- If the screen renders a real user label, its data contract must provide structured user data sufficient for that label context.
- Primitive-only user fields such as separate `display_name` and `rank` values are acceptable for non-label text, titles, or legacy data only when they are not used to render `UserLabel`.
- Adding structured user data to existing first-party responses must preserve authorization and visibility filtering.
