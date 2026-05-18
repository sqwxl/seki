# Research: UserLabel UserData Refactor

## Decision: Start with the `UserLabel` API

**Rationale**: The current API already exposes the key problem: it accepts `data`, but also still accepts separate `isOnline` and `rank` overrides, with TODO/FIXME notes indicating presence and context visibility are not fully modeled. Reworking the component API first gives all call-site updates a stable target.

**Alternatives considered**:

- Update call sites first: rejected because each caller would have to guess the future option shape.
- Add a second richer label component: rejected because it increases identity-display complexity and duplicates behavior.

## Decision: Use explicit context options for visibility

**Rationale**: The frontend spec defines context-specific visibility for stone, presence, rank, friend, bot, and compact labels. Explicit options keep those choices reviewable at each call site while centralizing rendering behavior.

**Alternatives considered**:

- Infer context from parent component names: rejected because it hides behavior and makes tests brittle.
- Hard-code all context presets inside `UserLabel`: rejected for now because current needs are small; named presets can be introduced later if repetition becomes meaningful.

## Decision: Fix primitive-only first-party data at the source

**Rationale**: The clarified spec requires first-party screens that render real users to receive complete user data for labels. This avoids fabricating partial user-like objects at the UI edge and supports future indicators without revisiting every caller.

**Alternatives considered**:

- Build partial `UserData` objects at call sites: rejected because it preserves the problem this feature is meant to remove.
- Leave primitive-only call sites unchanged: rejected because it would make the refactor incomplete and keep inconsistent identity rendering.

## Decision: Treat loading/empty/system cases as explicit fallbacks

**Rationale**: Some UI states do not represent a real user: empty player slots, unloaded chat senders, and server/system messages. These should remain explicit fallback states rather than fake `UserData`.

**Alternatives considered**:

- Require nullable or synthetic `UserData` everywhere: rejected because it blurs the difference between absent user data and a real anonymous user.

## Decision: Keep this feature independent from new rich-label capabilities

**Rationale**: The README still lists rich user labels as pending. This feature prepares the data flow and component API but should not add new friend, bot, or profile customization behavior beyond what current data already supports.

**Alternatives considered**:

- Implement all rich-label indicators now: rejected because it expands scope beyond the refactor and likely touches social/profile features.
