# Research: Player Rating System

## Decision: Use Glicko-2 through `skillratings`

**Rationale**: Glicko-2 includes rating deviation and volatility, which lets Seki represent rating uncertainty directly. The `skillratings` crate provides documented Glicko-2 support, an easy two-player API, MIT/Apache licensing, and default zero-dependency use. Using a library reduces correctness risk compared with implementing Glicko-2 from scratch.

**Alternatives considered**:
- `glicko_2`: convenient API and zero dependencies, but GPL-3.0-or-later licensing is a poor fit.
- `glicko2`: small and permissive, but its API is more rating-period oriented and requires more wrapper code for symmetric two-player updates.
- `liglicko2`: permissive and interesting, but Lichess-flavored/proof-oriented behavior is less conservative for Seki.
- Elo: simpler, but does not model rating uncertainty as cleanly.

## Decision: Store current Glicko-2 state separately from durable adjustment history

**Rationale**: The spec requires preserving rating history for future graphs. Current rating/deviation/volatility allows fast label rendering and uncertainty display; adjustment rows preserve the audit trail and chronological progression. This avoids reconstructing ratings from completed games later. Kyu/dan labels can be derived at read time or DTO-build time from stored numeric rating values.

**Alternatives considered**:
- Store only current rating: fails the history requirement.
- Derive history by replaying all games: fragile, slow, and breaks if rating parameters change.
- Store snapshots inside game rows only: awkward for profile history and user-centric graph data.

## Decision: Use rating deviation as the uncertainty signal

**Rationale**: Rating deviation is Glicko-2's native confidence measure. It is more accurate than game count alone and can support future uncertainty aging if rating periods are introduced. Seki appends `?` to kyu/dan or numeric rating display while deviation is above a configured provisional threshold.

**Alternatives considered**:
- Game-count threshold only: easy, but does not reflect actual confidence.
- Volatility threshold: useful context, but volatility measures instability rather than estimate uncertainty.
- Separate boolean flag: risks drifting from the actual rating model.

## Decision: Apply ratings from a single service after terminal game results

**Rationale**: Results are finalized through multiple paths: resignation, territory settlement, timeout/claim victory, abort/decline flows. A single rating service can enforce eligibility, skip unrated outcomes, and insert adjustment rows idempotently.

**Alternatives considered**:
- Duplicate rating updates in each action path: likely to diverge and risks double updates.
- Background sweeper: adds eventual consistency and recovery complexity before it is needed.

## Decision: Capture game-bound rating snapshots and derived ranked settings when both rated players are known

**Rationale**: The frontend spec requires rank qualifiers tied to a game context to remain static from game creation or seat fill. Store player rating/deviation/volatility snapshots and derived game settings when both seats become known. Derive game-bound kyu/dan labels from those stored rating snapshots so display remains stable without persisting presentation labels.

**Alternatives considered**:
- Always render current rank in history: violates game-bound semantics.
- Recalculate historical ranks from adjustment history for every view: expensive and couples display to calculation details.
- Persist kyu/dan labels with the snapshot: redundant with rating snapshots and harder to change if the presentation mapping changes.

## Decision: Use a configurable, versioned rating-to-rank calibration policy

**Rationale**: Early Seki usage may have only a few rated players, so a hardcoded rating-point-to-kyu/dan mapping would imply precision the system has not earned. Kyu/dan labels and handicap-step counts should be derived through a replaceable policy that maps numeric Glicko-2 ratings to Go-facing presentation. The first implementation may ship a simple provisional default, while future known-strength bot calibration can update the mapping without rewriting stored ratings or rating history.

**Alternatives considered**:
- Hardcode a fixed rating-point step: simple, but brittle for a small initial player pool and difficult to calibrate later.
- Persist kyu/dan labels with rating rows: stable display, but makes calibration changes mutate history or leave stale labels.
- Block kyu/dan display until bot calibration exists: accurate, but conflicts with the required default kyu/dan display.

## Decision: Ranked games automatically derive handicap, komi, and color from rating gap

**Rationale**: Handicap stones are the standard Go balancing mechanism for players of different strengths. Ranked games should not allow creator-selected handicap or komi because manual settings can distort rating outcomes. Automatic derivation keeps ranked games fair, understandable, and testable. Handicap-step counts come from the active rating-to-rank calibration policy, not from a hardcoded rating-point interval.

**Alternatives considered**:
- Even ranked games only: simpler, but prevents rated play across meaningful strength gaps.
- Manual handicap/komi in ranked games: flexible, but weakens rating integrity.
- Require both players to accept calculated settings: more explicit, but adds friction and more pre-game state for a first version.

## Decision: Lower numeric rating gets Black; exact rating ties use random color assignment

**Rationale**: In handicap practice, the weaker player plays Black. Glicko-2 rating is the persisted server strength signal, so it should break ties when players share a kyu/dan display label. When rating is exactly tied, there is no strength signal, so random/nigiri-style color assignment is fair.

**Alternatives considered**:
- Same kyu/dan always random: simpler for display, but ignores the authoritative rating gap.
- Creator chooses color when no handicap stones are assigned: user-controlled rated setting could bias outcomes.
- Always random color for ranked games: ignores the balancing role of color for small rating gaps.

## Decision: Ranked game creation and pre-game contexts always show numeric rating

**Rationale**: The default display is kyu/dan, but automatic color assignment may use numeric rating within the same visible rank. Showing numeric rating in ranked game creation and pre-game contexts explains why a same-rank opponent may receive Black or White.

**Alternatives considered**:
- Rely on hover-only alternate display: too easy to miss during game setup.
- Show only kyu/dan in setup: confusing when same visible rank leads to lower-rating color assignment.
- Force numeric rating display globally for ranked users: too intrusive; kyu/dan remains the desired default.

## Decision: Default registered users into ranking, with opt-out before future ranked play

**Rationale**: This follows the feature spec assumption, keeps the ranked-game path straightforward, and uses the `(-)` qualifier for users who opt out. Existing games keep the eligibility captured at creation/join time.

**Alternatives considered**:
- Explicit opt-in only: safer for privacy, but makes ranked-game discovery weaker and conflicts with the current spec assumption.
- No opt-out: simpler, but weaker user control.

## Decision: Default frontend rating display to kyu/dan with optional numeric rating display

**Rationale**: Kyu/dan is the Go-native presentation and should be the default. Numeric rating is still useful for users who prefer precision and for future analysis features. A global display preference keeps the UI consistent across labels, profile summaries, game lists, and challenge selection.

**Alternatives considered**:
- Kyu/dan only: hides the authoritative numeric score from users who care about it.
- Numeric rating only: less natural for Go players and conflicts with the README's kyu/dan target.
- Per-component display controls: too much UI complexity for a simple global preference.

## Decision: Show alternate rating format on compact-label hover

**Rationale**: User labels and game list rows are compact, so showing both numeric rating and kyu/dan inline would add clutter. Hover text or an equivalent accessible disclosure gives users the corresponding value without changing the primary display setting.

**Alternatives considered**:
- Always show both values: noisy in dense game lists and player panels.
- Hide the alternate value entirely: makes the display toggle harder to compare and verify.
- Popovers with full rating history: useful later, but too broad for the first rating feature.

## Decision: Enforce ranked-game constraints on both web and programmatic paths

**Rationale**: The constitution and API spec require server enforcement. Browser controls are only convenience. The same service-level checks should back `/games`, `/api/games`, join, challenge accept, and any websocket action that can affect game start or completion.

**Alternatives considered**:
- Browser-only validation: bypassable.
- Separate validation per route: risks inconsistent behavior.

## Decision: Do not change `go-engine` or `go-engine-wasm`

**Rationale**: Rating is web business logic around game outcomes, not Go rules, scoring, SGF, board state, or WASM boundary behavior.

**Alternatives considered**:
- Add rating to `go-engine`: violates layer ownership.
- Add rating helpers to WASM: would make browser behavior authoritative by accident.
