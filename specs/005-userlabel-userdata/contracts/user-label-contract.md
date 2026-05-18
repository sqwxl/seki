# Contract: User Label Rendering

## Component Contract

`UserLabel` renders one real user identity from structured user data plus explicit context options.

### Inputs

- `user`: structured user data for a real displayed user.
- `options`: explicit rendering choices for this context.
- `fallback`: optional fallback for loading, empty, unknown, or system-message states.

### Required behavior

- Display name comes from `user.display_name`.
- Profile links are derived from the structured user data when links are enabled.
- Rank display defaults to `user.rank` and may use a context rank only when preserving game-bound or display-mode semantics.
- Presence is shown only when the context opts in and has a presence state.
- Stone indicator is shown only when the context supplies a stone and the context allows it.
- Hidden indicators remain hidden through options, not by mutating or reducing `user`.
- No call site should construct a fake user from separate primitive fields to satisfy this contract.

## Call-Site Contract

Call sites that render real users must pass available `UserData` directly.

### Allowed call-site responsibilities

- Choose context options.
- Supply a presence state from local presence tracking.
- Supply game-bound rank only when needed.
- Supply explicit fallback for no-user states.

### Disallowed call-site responsibilities

- Split `UserData` into independent display-name/rank/profile primitives before passing it to `UserLabel`.
- Build partial user-like objects from primitive fields for real first-party users.
- Hide context indicators by deleting fields from user data.

## First-Party Data Contract

Any first-party screen payload that needs to render a real user label must include structured user data for that user.

### Known contract checks

- Chat message senders: message data must provide or be mappable from existing room user data to a real `UserData`; otherwise render an explicit fallback.
- Challenge user search and recent opponents: search/recent results must expose complete `UserData` for label rendering.
- Player panels and game descriptions: black/white player data must stay structured and should not be converted into separate label primitives.
- Current-user menu/bootstrap: current user data remains structured and can supply label identity directly.
