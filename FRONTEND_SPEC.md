# Frontend Behavior Specification

## Purpose

This document defines the intended behavior of the `seki-web/frontend` application. It is a product spec for the browser client: it describes the behavior the frontend should provide, including target-state UX and logic expectations that may extend beyond the current implementation.

The frontend is a Preact single-page shell mounted from [`seki-web/frontend/src/app.tsx`](/var/home/sqwxl/Projects/seki/seki-web/frontend/src/app.tsx). It provides:

- SPA navigation over same-origin web routes
- live game play and post-game review
- a standalone local analysis board
- user/session controls, preferences, and notifications
- a shared WebSocket connection for lobby and game updates

## Product Boundaries

The frontend is responsible for:

- rendering route-specific UI
- maintaining browser-local UI state
- connecting to `/ws` for realtime updates
- calling web/API endpoints for form submits and route hydration
- persisting some preferences and analysis state in `localStorage`

The frontend is not responsible for:

- authoritative rules enforcement
- clock arbitration
- game persistence
- authentication decisions
- notification email delivery

Those remain server responsibilities.

## Architecture Summary

### App shell

- `src/index.ts` mounts the app.
- `src/app.tsx` renders a persistent `<nav>` and route-specific `<main>`.
- route content is hydrated from `/api/web/*` JSON endpoints and lazy-loaded page modules.
- the app seeds a route-data cache from bootstrap JSON when present.

### State model

- live game state uses `@preact/signals` in [`seki-web/frontend/src/game/state.ts`](/var/home/sqwxl/Projects/seki/seki-web/frontend/src/game/state.ts).
- analysis mode uses a separate signal set in [`seki-web/frontend/src/layouts/analysis-state.ts`](/var/home/sqwxl/Projects/seki/seki-web/frontend/src/layouts/analysis-state.ts).
- controls and visible affordances are derived from capability selectors in [`seki-web/frontend/src/game/capabilities.ts`](/var/home/sqwxl/Projects/seki/seki-web/frontend/src/game/capabilities.ts).

### Realtime transport

- one shared WebSocket connects to `/ws`.
- lobby events are subscribed by message `kind`.
- game-specific events are routed by `game_id`.
- the client auto-reconnects, re-joins active game rooms, and flushes queued outbound messages after reconnect.

## Global Application Behavior

### Initial startup

On app mount the client must:

1. initialize user preferences from session-provided user data
2. initialize theme from preferences/local storage
3. initialize unread-game tracking
4. ensure the shared WebSocket is connected
5. render the route matching the current URL

### Navigation model

The frontend treats same-origin anchor clicks as SPA navigations unless the link:

- is modified by keyboard modifiers
- is non-left-click
- has a `target`
- has a `download` attribute
- points to `/api*`, `/static*`, or `/up`
- points off-origin

Expected behavior:

- `history.pushState` is used for normal internal navigation.
- `history.replaceState` is used for redirect-style navigations.
- `popstate` restores prior routes.
- route data is prefetched on hover, focus, and touchstart.
- route changes outside `/games/:id` scroll to top.
- a frontend routing library like `preact-iso` may be used to handle routing and history manipulation.

### Route data loading

For data-backed routes, the client:

- reads bootstrap data first when available
- caches fetched route JSON by URL
- deduplicates concurrent route fetches
- shows a work indicator (spinner, loading..., etc) while data or lazy modules are pending
- shows an actionable error message when a route fetch fails

### Head metadata

Each route is responsible for updating:

- `document.title`
- `meta[property="og:title"]`
- `meta[property="og:description"]` when a description is provided

Document-title behavior:

- `/games/:id` should use the game-description string as its normal document title
- `YOUR MOVE` flashing should occur only for the currently open game when a new move arrives and the browser tab is inactive
- chat unread state should not affect document title
- friend requests should not affect document title
- other bell-notification types should not affect document title

## Persistent Navigation UI

The top nav is always present and visible and contains:

- new game link
- games list link
- analysis page link
- local connection status indicator
- notification bell
- user menu

### Connection indicator

- hidden while the shared WebSocket is healthy
- shown after roughly 3 seconds of confirmed local disconnect to avoid flicker
- indicates that reconnect is in progress (spinner)

### Notification bell

The bell dropdown must:

- show unread games tracked client-side
- label challenge entries as `Challenge from ${USER}`
- label move entries as `Your turn: ${B} vs ${W}`
- clear unread state for a game when its dropdown link is clicked
- expose an OS-notifications toggle when browser notifications are supported

Bell notification behavior:

- bell notifications should not be grouped by type and should be ordered by most recent first
- message notifications are the exception: they should be grouped to one notification per game regardless of unread message count
- most bell notifications should clear when the user views the relevant destination/context
- friend-request notifications should persist until the user explicitly accepts or rejects the request

Bell item click behavior:

- clicking any bell item should dismiss the dropdown
- clicking an unread-message notification should open the relevant game and, on mobile, activate the chat tab
- clicking a your-turn notification should open the relevant game
- clicking a friend-request notification should open the response dialog rather than navigating away
- opening a user profile should not by itself clear a friend-request notification

### User menu

The user menu must expose:

- profile link for the current display name
- theme cycle control
- move-confirmation toggle
- coordinates toggle
- move-tree toggle
- auth actions

Auth action rules:

- registered users see `Log out`
- guests see `Log in` and `Register`

Preference toggles must apply immediately in the current UI and also persist through the preference save path.

## User and Preference Model

### Preference sources of truth

Preferences are merged from:

1. server-provided `UserData.preferences`
2. `localStorage`

Expected conflict behavior:

- server values win during initialization (\* see caveat below concerning local analysis trees)
- merged values are written back into `localStorage`
- runtime toggles update UI immediately and then fire a best-effort server save
- save failures must not roll back the local UI state

### Persisted browser preferences

The client persists at least:

- theme
- move confirmation setting
- show coordinates setting
- show move tree setting
- notification permission preference blob
- new-game form defaults
- standalone analysis size
- standalone analysis komi
- standalone analysis SGF metadata/text
- per-game analysis trees/snapshots

### Move confirmation default

If no stored preference exists:

- move confirmation defaults to `true` on viewports matching `max-width: 1199px`
- otherwise defaults to `false`

## Cross-Cutting UX and Platform

### Mobile tab behavior

On mobile layout, game-oriented pages should use a tab-bar model to switch between primary panels.

Expected behavior:

- the tab bar should be visible on game and analysis pages when the viewport width is less than `1200px`
- on live game pages, the live/board view is the default panel
- the active mobile tab should persist across navigation
- switching tabs should not reset or otherwise disturb panel-local scroll state, such as move-tree scroll position
- switching tabs should not clear or reset in-progress input state, such as pending move confirmation
- chat should be marked as read when the chat tab is opened while the browser tab itself is active

### SPA navigation teardown and restore

SPA navigation should distinguish between disposable route-local UI, long-lived app services, restorable local work, and authoritative server state.

Route-local ephemeral UI:

- purely ephemeral view state should be torn down on route exit
- this includes transient popovers/dialogs, hover/pressed state, route-scoped banners, and DOM attachment state owned only by the mounted screen

Route-owned live resources:

- resources created by a route should be disposed when that route unmounts
- this includes page-owned subscriptions, timers, event listeners, board/WASM instances, and route-specific effect subscriptions
- globally shared app services may survive route changes, such as the shared WebSocket connection and global unread tracking

In-flight async work:

- navigation/data fetches do not need to be cancelled by default, but late results should only affect the app if they still apply to the current route or a reusable cache entry
- mutation/action requests should generally continue after navigation rather than being cancelled
- search/typeahead/background helper requests may be cancelled when their owning UI context disappears
- module/code loading may continue after navigation, but it must not mount into an unmounted route

Pending UI:

- pending UI should be dismissed if its underlying async work was cancelled
- pending UI may remain restorable if the underlying async work is still unresolved and still meaningful when the route is revisited

Restore model:

- returning to a route should restore the latest cached state immediately when available
- returning to a route should also trigger a fetch for the latest authoritative server state
- restorable local work should be reapplied on top of the latest valid route state when appropriate

Mutation and cache refresh policy:

- mutation responses should be used primarily for immediate UX decisions such as success/failure, pending-state resolution, and navigation targets
- authoritative websocket updates and route refetches are the primary source of post-mutation truth
- the current route cache may be invalidated after a successful route-local mutation
- related non-current route caches may remain stale until the next visit unless there is a strong UX reason to refresh them immediately
- live game state should reconcile from authoritative websocket/state sync rather than broad manual cache patching
- unread/bell state should also reconcile from authoritative sync rather than from ad hoc mutation-response patching

Live-game route restore rules:

- active mobile tab should be restored
- pending move confirmation should be forgotten
- pending undo confirmation UI should be restored
- pending resign confirmation UI should be forgotten
- pending presentation-request UI should be restored
- pending abort confirmation UI should be forgotten
- local analysis state should be restored, with the local tree merged against the latest authoritative/base game tree
- move-tree scroll position should not be restored

### Form and draft behavior

Forms should prefer constrained inputs and submit-time validation over aggressive draft persistence or interruption warnings.

Expected behavior:

- drafts do not need to autosave while the user is typing
- validation may happen primarily on submit
- navigating away with unsaved changes does not require a browser warning or custom confirmation flow
- form controls should constrain input to server-acceptable normalized values whenever practical, so users are prevented from entering invalid shapes of data in the first place
- server-normalized value rules should be reflected directly in the available input affordances, for example by preventing whole-number komi values where only half-integer komi is valid

Error presentation:

- field-specific validation errors should render inline next to or directly beneath the relevant field
- form-level errors should render at the beginning of the form
- when validation errors render, the browser should scroll to the topmost validation error

### Motion and animation

Motion should be minimal, purposeful, and compatible with reduced-motion preferences.

Expected behavior:

- flash banners should use short fade-in and fade-out animations of about `250ms`
- page transitions should be instant and should not animate between routes
- navigation interactions should not introduce movement/transition animation
- spinners should use a dedicated icon/component that encapsulates the spinner’s animation behavior
- live theme switching should use a short transition of about `250ms`
- reduced-motion preferences should be respected across animated UI feedback

### Platform and browser support

The frontend should treat both desktop and mobile web as first-class targets.

Expected behavior:

- CSS/layout design should be mobile-first
- tablet layouts may behave like either mobile or desktop depending on breakpoint/layout choice
- touch crosshair play input should be enabled on touch-capable devices regardless of whether the device is phone, tablet, or touch desktop
- keyboard shortcuts are never required for core use; any keyboard-accessible action must also have a visual/pointer-based control path
- the app targets modern browsers
- full application behavior does not need to work without JavaScript beyond the initial delivered shell

### Accessibility

Accessibility expectations currently focus on keyboard access, contrast, labeling, and semantic structure.

Keyboard shortcuts:

- `ArrowLeft`: step backward in the active move-tree branch
- `ArrowRight`: step forward in the active move-tree branch
- `ArrowUp`: go to the beginning of the active move-tree branch
- `ArrowDown`: go to the end of the active move-tree branch

Keyboard and focus behavior:

- keyboard shortcuts should be disabled while text inputs are focused
- move-tree/navigation shortcuts should work on both live-game and analysis pages
- `Enter` should confirm a pending move when move confirmation is active
- `Escape` should dismiss confirmation dialogs using the dialog’s cancel action
- `Escape` should dismiss flash banners
- `Escape` on request dialogs such as undo-response or presentation-control requests should trigger the reject/dismiss variant
- `Escape` in local analysis should return the user to the live game or active presentation, as applicable
- when a confirmation dialog opens, focus should move to its `Cancel` button
- when an undo or presentation request-response dialog opens, focus should move to its accept/approve button
- clicking the chat tab in mobile view should move focus to the chat input
- restoring the chat tab on reload should not automatically move focus to the chat input

Current scope limits:

- screen-reader support is not a current requirement

General accessibility expectations:

- the app should provide a high-contrast option for the whole application
- icon-only controls should have accessible labeling via attributes such as `title`
- the app should respect W3C minimum contrast ratios
- the DOM tree should use semantic HTML elements where appropriate

### Theming and appearance

Theme behavior:

- supported theme modes are `system`, `light`, and `dark`
- when theme mode is set to `system`, the app should respect the current OS color-scheme preference
- theme switching should hot-swap live without requiring navigation or reload
- assets, icons, and glyph treatments should update immediately on theme change
- high-contrast mode should support both light and dark variants

Board and stone appearance:

- users should be able to choose from appearance presets for board and stones
- board appearance should also be individually configurable
- black-stone appearance should be individually configurable
- white-stone appearance should be individually configurable
- board and stone appearance variants should respect both theme behavior and contrast-ratio requirements

### Persistence scope

Preference and state persistence should distinguish between browser-local settings, account-level settings, and merge-synced analysis state.

Browser-local by default:

- nearly all frontend preferences should be browser-local regardless of whether the user is a guest or a registered user
- this includes theme mode, high-contrast mode, board/stone appearance, move confirmation, local UI layout preferences, and similar presentation-oriented settings
- the OS notification enabled/disabled toggle is browser-local

Account-level preferences:

- granular notification preferences are account-level
- the server is authoritative for account-level preference values

Analysis trees:

- analysis trees should be saved both locally and server-side
- local analysis trees should merge-sync with the server version rather than behaving as simple last-write-wins replacements
- server-stored analysis trees may be cleared after `30 days`

Analysis-tree merge rules:

- if local and server trees contain different branches from the same node, all distinct branches should be preserved
- the currently active/current node does not need to be persisted server-side
- deletions are not part of the merge model for now
- branch ordering does not need semantic meaning, but tree merge results and rendered display order should be deterministic
- corrupt or invalid trees should be rejected and overwritten by a valid version

### Guest and session identity behavior

Guest, anonymous, and auto-created users all refer to the same session-backed user model.

Expected behavior:

- when a new unauthenticated session is created, the system should create an anonymous user identity for that session
- day-to-day application use is mostly identical for guests and registered users except where the spec explicitly restricts features to registered users
- display names should be editable both before and after registration
- the registration form should initially contain the username/display name of the anonymous session that initiated it
- registering should preserve the same user identity, including user id and prior game history, from the anonymous session
- guest users may receive challenges and may join private games when otherwise authorized
- guest users may not participate in ranked games

### Clipboard and share behavior

Clipboard/share interactions should provide lightweight confirmation and a manual fallback where appropriate.

Expected behavior:

- successful copy actions should show a short `Copied!` confirmation in the triggering button content
- invite links should remain available for manual highlight-and-copy even when copy/share helpers are present
- native share sheets may be used on mobile where appropriate
- clipboard/share feedback should not redact copied values in the UI response
- no additional clipboard/share entry points are required beyond the explicitly defined token and invite-link cases

## Game and Social Domain Rules

### Friends and social behavior

The frontend should support a lightweight friend-request model for registered users.

Expected behavior:

- users may send friend requests to registered players
- incoming friend requests should be surfaced through the unread notification/bell system
- a friend request should remain unread until the recipient explicitly accepts or rejects it
- recipients should be able to accept or reject a friend request from the request dialog/notification flow
- friend relationships should have precedence in ordering wherever the spec refers to friend-prioritized lists
- friend status should be indicated with a dedicated icon next to the user label

Friend-request lifecycle:

- if a friend-request dialog is dismissed without a choice, the notification should remain in the dropdown and be reopenable by clicking it again
- dismissing the dialog without a decision keeps the request unread/pending for notification purposes
- the only outgoing pending indicator should be the profile-page friend button changing to a disabled `Friend request pending` state
- outgoing pending friend-request state does not need to be shown elsewhere in the UI
- accept/reject actions for friend requests should not use optimistic UI; they should resolve only on server confirmation
- opening the friend-request dialog in one tab should not itself clear or mutate unread state in another tab
- accepting or rejecting a friend request in one tab should clear the corresponding notification everywhere
- friend-request notifications should be ordered by most recent first

### User labels and identity display

User labels should use a consistent compositional structure across the app.

Base user-label structure:

- `[stone icon] <display name> [presence indicator] [rank qualifier] [friend icon]`

Stone icon visibility:

- the stone icon should be shown in player panels
- the stone icon should be shown in the game user list
- the stone icon should be shown in chat sender labels
- the stone icon should be shown in game lists
- the stone icon should be reflected in the game document title

Presence indicator visibility:

- the presence indicator should be shown everywhere except the document title

Friend icon visibility:

- the friend icon should be shown in the game user list
- the friend icon should be shown in chat sender labels
- the friend icon should be shown in game lists
- the friend icon should be shown in the user profile
- the friend icon should be shown in challenge-user selection UI

Rank qualifier rules:

- `(?)` for an unranked registered user
- `(-)` for a registered user who is not participating in ranking
- `(<rank>)` for a ranked registered user
- unregistered users should have no rank qualifier

Rank qualifier visibility:

- the rank qualifier should be shown in the game-info popover
- the rank qualifier should be shown in player panels
- the rank qualifier should be shown in game lists
- the rank qualifier should be shown in the player profile title
- the rank qualifier should be shown in challenge-user selection UI

Game-bound rank semantics:

- when a rank qualifier is tied to a specific game context, it should be treated as static from the time of game creation or seat fill

Anonymous-user behavior:

- anonymous users should appear like regular users except without a rank qualifier
- anonymous users should still have viewable profiles

Identity rules:

- duplicate display names are not allowed
- display name and username are the same identifier

### Bot users

Bot users are registered users with a dedicated bot flag.

Expected behavior:

- bot users are represented as normal registered users with an `is_bot` flag
- bot users may participate in ranked games
- bot users may not create games
- bot users may not join games manually
- bot users may not spectate games as ordinary viewers
- users may challenge bots
- users may not friend bots
- users may not direct-message bots
- bot users have profiles
- bot users have presence states like other users
- bot actions are treated the same as human actions for clocks, chat, notifications, and presentation behavior
- in user-label rendering, the friend-icon slot should show a bot icon for bot users

### Ranking and rated-game behavior

Game rating status should be determined at creation time and remain independent of spectators.

Expected behavior:

- a game is ranked only if the ranked option was selected at creation time
- invite-only games, including direct challenges, may be ranked
- private games cannot be ranked
- spectator presence has no effect on whether a game is ranked

Rated/unrated display:

- unrated status should be shown in the game-info popover
- unrated games should append `(unrated)` to their description in game lists

### Game creation, challenge, and join constraints

Game creation rules should clearly constrain valid combinations of privacy, ranking, and opponent-selection mode.

Expected behavior:

- unranked games may be private, invite-only, or open
- unranked games may also be direct challenges
- ranked games must be either direct challenges or open
- ranked games are restricted to registered users
- ranked games cannot be invite-only
- open games cannot later be converted into direct challenges
- challenge recipients cannot adjust game settings before accepting
- game settings become immutable once the game is created

Color-assignment behavior:

- when the creator selects `Black` or `White`, that choice determines the creator’s own color
- when the creator selects `Nigiri` / random, colors are assigned when the opponent accepts the challenge or joins the open game
- before the game starts under nigiri/random assignment, stone icons should use the nigiri icon treatment
- ranked games may use nigiri/random color assignment

Pre-start color display:

- game lists should always display players in `Black vs White` order
- for unstarted nigiri/random games, the creator should temporarily occupy the black slot for list/display purposes until colors are resolved
- pregame popovers should show the pending nigiri/random color mode when applicable
- declined or aborted pre-resolution nigiri games should preserve that pre-resolution display in history contexts
- game-info/popover UI should show color preference or nigiri mode before acceptance/join resolves final colors

Rematch behavior:

- rematch submits a form POST to `/games/:id/rematch`
- when rematch is available, the web UI exposes a rematch action on the game page
- optional color-swap is included as form data
- optional game rules adjust
- successful response navigates to the returned redirect
- failed response shows a flash alert with the error message
- rematch may be offered for any finished game where both player seats were filled
- all settings carry forward by default
- any setting may be changed for the rematch except the opponents
- spectators have no control over rematch creation and do not influence rematch options

## Route Specification

### `/` and `/games`

This route renders the lobby game list.

Data source:

- `/api/web/games`
- live updates from lobby WebSocket messages

- document title is `Games - Seki`

Displayed sections:

- `Challenges`
- `Your games`
- `Open games`
- `Public games`

Expected filtering:

- incoming and outgoing challenges for the current player appear in `Challenges`
- the player’s non-challenge games appear in `Your games`
- games with at least one empty seat and not private/invite-only appear in `Open games`
- public started games appear in `Public games`
- aborted and declined games are excluded from lobby-facing sections except where explicitly retained elsewhere

Expected item behavior:

- items link to `/games/:id`
- private games show a private badge (and are only listed for participating users)
- games where it is the current user’s turn get `your-turn` styling/title
- dismissed results (`Aborted`, `Declined`) render with dismissed styling when shown

Expected item ordering:

- within each section items are order by: your-turn, has friends, updated_at desc
- `your turn` outranks all other ordering criteria
- final tie-breaker is game id descending

Accessible private/invite visibility:

- private and invite-protected games should appear in a user’s lists once that user has joined the game, whether as a player or spectator
- finished private/invite games should remain in profile history, with visibility still restricted to authorized viewers
- private games do not participate in rating

Realtime lobby behavior:

- `init` replaces the current lobby dataset
- `game_created` inserts a game (respecting list ordering)
- `game_updated` patches an existing known game (updating ordering if needed)
- `game_removed` removes a game from the lobby list

### `/games/new`

This route renders the new-game form and submits via SPA form POST.

Data source:

- `/api/web/games/new`

Expected behavior:

- document title is `New Game - Seki`
- route query `opponent` preloads challenge context
- route query `error` displays a flash message
- successful submit posts to `/games` and navigates to the returned redirect
- failed submit shows the returned error without full-page reload

Form behavior expectations:

- settings are restored from local storage when available
- submitting the form persists current form settings locally
- Enter on non-button inputs is intercepted to move focus instead of triggering accidental submit
- board size changes clamp handicap down to the size-specific maximum
- handicap changes to >2 set komi to 0.5

Opponent selection behavior:

- challenge mode fetches recent opponents (friends first) once on first entry
- typed search is debounced by about 300ms
- starting a new search aborts the previous request
- clearing the query clears search results (shows default opponents)

User-search behavior:

- user search should begin once the query reaches at least `1` character
- matching should be fuzzy rather than exact-only
- anonymous users should appear in search results when otherwise eligible
- blocked users should be filtered out of results
- ineligible users should be filtered out, for example anonymous users when the current game configuration requires registered participants
- result ordering should be: online, friend, registered, anonymous, last active descending, alphabetical
- search-result labeling should use the full user-label presentation minus the stone icon

Game settings exposed by the form include:

- board size
- komi
- handicap
- color preference
- undo allowance
- privacy mode
- time control settings
- notification fields where relevant
- challenge/invite/open opponent targeting

### `/games/:id`

This route renders the live game application.

Data sources:

- `/api/web/games/:id`
- optional `token` query parameter for private/invite access
- `/ws` game room subscription via `join_game`

Boot behavior:

- document title set to e.g. `${B} ● vs ${W} ○ - 13×13 - H4 - W+R`
- black and white symbols in document title swapped with theme change (light mode: B=●, W=○; dark mode: B=○, W=●)
- reset prior live-game runtime state
- reset phase state
- derive the current player’s stone from session user vs black/white players
- initialize signals from server-provided initial props
- load initial chat log
- restore per-game analysis snapshot from local storage when entering analysis
- load WASM board engine and mount the goban UI

#### Live game phases

The live game UI can represent at least these broad modes:

- lobby/challenge (awaiting join or accept)
- unstarted (all player slots filled, waiting for first move)
- active play
- territory review
- completed game (resignation, score, time)
- aborted game
- local analysis
- score estimate
- collaborative presentation

Visible controls are capability-driven and must reflect current state, role, and navigation position instead of using static button sets.

#### Board interaction rules

While in the live game route:

- clicks on historical positions must not send live moves
- spectators (`playerStone === 0`) must not send play actions
- completed games must not allow live play
- lobby/challenge-stage boards must not allow live play
- in territory review, clicking occupied intersections toggles dead/alive chains; clicking empty intersections has no effect
- during the player’s turn, a legal click either sends a move immediately or sets a pending confirmation point depending on move-confirmation preference
- clicking the same pending point again confirms the move

Pointer and touch interaction:

- mouse hover has no special board-preview behavior beyond normal cursoring
- there is no special handling for right-click
- there is no special handling for long-press
- drag interaction is used only for touch crosshair input
- on touch-capable play states, single-finger interaction should activate a crosshair-based targeting mode
- the touch crosshair should track the current targeted vertex during touch move
- the touch crosshair should clear on multitouch, touch cancel, or when the touch moves sufficiently far away from the board
- the touch target should commit on touch end
- for illegal points, touch crosshair preview and ghost-stone preview should not be shown
- touch interaction should disable native touch scrolling on the active board surface while crosshair targeting is active

Board markers and overlays:

- coordinate overlays are user-toggleable from the user menu
- the last-move marker is always visible in normal board views
- the last-move marker is hidden in territory-review and estimate-overlay views

When move confirmation is enabled:

- a ghost stone is shown for the pending move
- clicking outside the goban, outside the confirm control, or on any illegal point dismisses the pending move
- non-play live updates (resignations, timeouts, etc) clear the pending move when the game is no longer in a playable stage
- any event that changes turn (e.g. accepting an undo request, passing your turn) dismisses the pending move

#### Navigation and move tree

The live route must support move-tree navigation on the board.

Expected behavior:

- navigation state exposes start/latest/main-end status and a move counter
- local historical navigation is allowed without altering server state
- exiting live analysis (either by clicking the move counter, or the exit analysis button) returns to main-end in normal live mode
- move-tree visibility follows the user preference in live game mode, always shown in analysis mode
- move-tree auto-scrolls to keep the current active node in view on first load or when active node changes

Local-analysis synchronization rules:

- if a new real game move arrives while the user is in local analysis, the client should automatically switch back to live view
- local branches attached to still-valid historical nodes should remain valid when the base game advances
- if a move is undone, any analysis variations branching from that undone move should also be dropped
- entering local analysis from a finished game behaves the same as entering it from an in-progress game
- SGF export always includes the current analysis tree rather than exporting only the base game
- returning to live always moves the cursor to the latest node on the main branch

Move-tree rendering semantics:

- the root/empty-board node should be visible and rendered as a cross
- branching should render as a distinct parallel row or column originating from the branching node
- branching from a finalized node is allowed and should render as a new branch, not as a continuation along the finalized node’s existing branch
- finalized nodes do not need a special standalone visual marker; their branching behavior is the meaningful distinction
- move-tree direction should be horizontal on mobile and vertical on desktop
- the move counter should reflect the actual move number of the currently viewed node
- passes count as moves for move-counter purposes
- finalized state does not create a separate move-tree node
- the root node has move count `0`

#### Chat behavior

The live route includes chat.

Expected behavior:

- chat auto-scrolls to the latest message when message count changes
- sending trims whitespace and ignores empty submissions
- messages can show move number and timestamp prefixes when configured by the page
- server/system messages may have no user and render with a flag marker
- known black/white players render with colored stone labels
- online presence affects chat/user label presence indicators

Chat semantics:

- chat ordering should follow the client-visible timestamp of the received/confirmed message
- optimistic/pending local messages should be reordered if needed when the authoritative server-confirmed message arrives
- optimistic/pending local messages are page-local only and should not be restored across navigation or reload
- pending local chat messages may be retried after websocket reconnect only while the user remains on the same live-game page
- pending local chat messages should be discarded on navigation or reload if they were never confirmed
- chat supports system messages
- chat does not support message editing
- chat does not support message deletion
- chat messages have a maximum length of `160` characters
- chat should resync on reload and reconnect
- chat rendering must deduplicate messages by message id
- chat history is not paginated
- chat history is unbounded in the UI
- a game’s chat must become locked against new messages once the game has ended and all players/spectators have left
- a game’s chat must also become locked if the game has been abandoned for more than `24h`
- once chat becomes locked, the lock is permanent
- locked chat still shows full prior history
- when chat is locked, the input field and send button should both be disabled
- once chat is locked, no further system messages should be emitted into that chat stream

Unread-chat behavior:

- unread chat state is tracked per game, not per individual unread message count
- on desktop, unread chat should clear when the chat panel is visible in the active browser tab
- on mobile, unread chat should clear when the chat tab is opened in the active browser tab
- scrolling to the bottom is not required to clear unread chat
- sending a chat message should clear unread chat for that game
- if a new message arrives while the game’s chat view is open but the browser tab is inactive, the game should remain unread until the tab becomes active and the chat view condition is satisfied again

Presence and chat-lock semantics:

- spectators and players use the same unread-chat clearing rules
- merely having a game open in a background or inactive tab does not count as active presence for chat-lock purposes
- the same non-background-presence rule applies to both spectators and players
- chat-lock/presence evaluation should be based on distinct users rather than raw browser-tab count

Presence model:

- presence should distinguish at least `online`, `away`, and `offline`
- a user in an inactive/background tab should still appear present, but as `away`
- away users should remain visible in the room user list
- presentation-eligibility logic should use active presence rather than merely connected/away presence
- ordering that depends on availability should use `online > away > offline`

Presence-indicator UI:

- `away` should have its own distinct indicator separate from `online`
- `offline` should have no presence indicator
- presence should be conveyed by the indicator alone without extra text labels
- presence indicators do not need different visual rules between user labels and room-user-list rows
- presence state should not alter friend-icon rendering or introduce extra ordering labels in the UI

System-chat policy:

- the only system-chat message currently required is `Game over. <result>`, including abort/decline terminal outcomes
- other game events do not need system-chat messages for now
- system messages should carry normal chat timestamp behavior
- system messages should not count toward unread chat
- separate muting controls for system messages are not necessary

#### Presence and disconnect behavior

The client tracks online users and opponent disconnect state.

Expected behavior:

- presence subscriptions are requested for relevant user ids
- disconnect/reconnect messages update player online indicators (with 3s grace period to avoid flickering)
- opponent disconnect state records disconnect time, grace period, and whether the opponent is fully gone
- reconnect clears opponent-disconnect warnings
- opponent-disconnect state should be presented through the normal game-status/disconnect UI rather than via ad hoc chat messages or unrelated banners
- disconnect countdown and claim-victory availability should use a consistent visual treatment wherever that state appears on the live game route

#### Clock behavior

The client treats the server as authoritative for clock state.

Expected behavior:

- clock state syncs from game messages
- client-side ticking is used only for display between syncs
- move submissions include approximate client move time when available
- timeout flag actions are sent when the local synced clock logic determines expiry
- live clock display formatting should follow these rules:
  - correspondence time displays as `Dd Hh` when at least one day remains, otherwise `Hh Mm`
  - non-correspondence time under `10s` displays with tenths precision
  - non-correspondence time at `10s` or above displays in rounded-up `M:SS` form, or `Hh Mm` once at least one hour remains
  - byo-yomi period indicators append `SD` for the final sudden-death period, or `(<periods>)` when more than one period remains
- display rounding should use ceiling-style or nearest-integer presentation rather than flooring away visible remaining time
- low-time clocks should be styled in red
- under low-time conditions, clock display should show sub-second precision in `SS.MS`-style output
- correspondence clocks should continue ticking in the background like other clocks, even if their displayed `Dd Hh` or `Hh Mm` format does not show immediate second-by-second visual change
- if time appears locally expired before server confirmation, further player input should be prevented and game status should show a spinner while awaiting authoritative resolution
- manual claim-style resolution should only apply to the established disconnect/gone criteria, not to ordinary clock expiry

Low-time behavior:

- a clock enters low-time state at `<= 1 minute` remaining
- the same threshold applies across time-control types, including correspondence
- in byo-yomi, `SD` should always be styled in red even if the general low-time threshold would not otherwise apply
- low-time state currently affects visual styling only and does not change notification or sound behavior

#### Sound and attention behavior

The live route must provide move feedback:

- stone-play sound on live play messages
- pass sound on pass events
- pass flash animation on the goban for live pass events
- turn/title flashing and browser notifications when the user should be notified
- stone-play sound for manual entry in analysis mode (i.e. not for back/forward navigation or move-tree navigation)

Notification seeding rule:

- initial state sync must seed notification tracking without firing a false-positive notification for already-existing moves

Sound policy:

- sound should be user-toggleable through a browser-local preference that affects the whole app
- sound behavior does not need to change based on browser-tab focus, away state, or similar attention state
- in presentation mode, if an action would make a sound for the presenter, it should also make the same sound for spectators
- chat, friend-request, and other notification flows do not require dedicated sounds
- reduced-motion or accessibility settings do not need to change sound defaults

#### Territory review and game end

Expected behavior:

- server territory review shows an ownership/dead-stone overlay
- accepting score sends `approve_territory` message
- accepting score starts auto-accept countdown shown in game status component
- territory approvals do not append chat notices when black or white newly accepts
- toggling dead stones resets approvals
- when territory is agreed, the base tip is marked settled on the board
- settled territory on finished games can be shown in estimate mode without server round-trips

Territory-review and estimate interaction semantics:

- dead-stone review should support toggling both whole chains and individual stones
- spectators should see synchronized live territory-review state but should not participate in modifying or approving it
- estimate mode entered from a completed game should use the same core visuals as live territory review
- estimate mode itself does not have a separate confirm action; users exit back to live game or analysis depending on where estimate mode was entered from
- once a local finalized territory-review node is finalized, it is not directly editable
- analysis-only estimate mode may still be used to inspect alternate scoring outcomes without affecting the actual game result
- finalizing territory review in analysis on an already-finalized node should create a new finalized node on a variation branch from that node’s parent, using the same move position with a different result
- if the newly finalized result matches the existing finalized result, no new node should be created
- in analysis, passing twice should always auto-enter territory review
- on finished games, move-counter clicks and similar navigation affordances must not trigger a new territory-review flow; they may only perform their normal navigation or analysis-exit behavior

#### Status precedence

Top-level game status should be single-source and state-driven rather than composed from multiple competing banners.

General rules:

- every meaningful game/view state should resolve to exactly one primary game-status message
- flash banners sit above game status and have higher visual precedence, but do not replace the underlying state-derived game status
- pending-action spinners and validation errors do not alter game-status text
- estimate status overrides normal live-turn text
- disconnect conditions participate in the state model and may override normal turn/review text where specified below

Expected status outcomes:

- live game with opponent temporarily disconnected during the reconnect window: show the regular game status, for example `White to play`
- live game with opponent gone and claim-victory available: show a disconnection status, for example `White disconnected`
- territory review with opponent accepted and countdown running: show result plus timer, for example `B+10.5 (25s)`
- territory review with opponent disconnected: use the disconnection status rather than the normal territory-review text
- presentation active while presenter is temporarily disconnected: show the regular game status with the normal presentation suffix behavior
- presentation after presenter disconnect has resolved into control change or presentation end: show the regular resulting status, for example `Black to play (<user> presenting)` or `Black to play`
- completed game in estimate mode: show the estimate result, for example `W+0.5`
- completed game outside estimate mode: show the settled result, for example `B+T` or `B+R`

#### Result semantics and visibility

Result display should distinguish canonical game outcomes from local/provisional inspection values.

Canonical vs local results:

- only canonical/final game outcomes should propagate into shared game metadata
- canonical outcomes include ordinary finished-game results such as `B+R`, `W+T`, score-agreed final results, and terminal pseudo-results such as `Aborted` and `Declined`
- provisional/local results include estimate-mode score readouts and alternate finalized analysis outcomes
- provisional/local results must remain local to the active analysis or estimate UI and must never overwrite canonical game metadata

Estimate and analysis result visibility:

- estimate results are for inspection only
- estimate results must never appear in game lists
- estimate results must never appear in profile history rows
- estimate results must never appear in the document title
- alternate finalized analysis results remain analysis-only and must never affect canonical/shared game metadata

Aborted/declined semantics:

- `Aborted` and `Declined` are not true played-game results, but they should be treated as terminal result-like values throughout most of the UI
- `Aborted` and `Declined` should be excluded from normal lobby/public game-list sections
- `Aborted` and `Declined` should remain visible in history/profile contexts

Result-string display:

- status bar should show the full result string whenever a canonical result is the active status
- game-list rows should use the full canonical result string when a result is shown
- profile-history rows should use the full canonical result string
- document title should use the full canonical result string
- game-info popover should use the full canonical result string

#### Undo behavior

Expected behavior:

- users can request undo only when capabilities permit it
- server messages drive `sent`, `received`, `rejected`, and cleared undo states
- accepted/rejected undo responses clear pending move confirmation
- undo sync can also refresh board state and clocks
- pending undo requests persist page reload and server restarts
- users may not request an undo if a previous request has already been declined for the current move

Undo restore/reconnect behavior:

- a sent undo request should reopen its pending UI after reload if the authoritative game state still indicates that request is pending
- a received undo request should reopen its response UI after reload if the authoritative game state still indicates that request is pending
- expired, resolved, or superseded undo requests should disappear silently on authoritative resync
- undo state after reload/reconnect should be reconciled from authoritative server state rather than blindly restored from cached local UI state
- undo rejection state should remain visible after reload until the move changes, so long as the authoritative state still marks that rejection for the current move

#### Challenge/lobby actions inside a game

Depending on capabilities, the game route may expose:

- join/open-seat action
- accept challenge
- decline challenge
- abort game (only creator)
- resign game (only once started)
- invite link (gives access to private games)
- claim victory after opponent disconnect/gone timeout
- rematch

Pre-start lobby/challenge popover behavior:

- the pre-start popover is only visible to visitors before the game starts
- all visitors see the same structural information, but title and buttons vary by role/state
- the default title is `Waiting for <user>` or `Waiting for opponent`
- for the challenge recipient, the title should instead be `<user> has challenged you`
- the creator always sees the same primary action in the pre-start popover: `Abort`
- for challenge games, the challenge recipient sees `Accept` and `Decline`
- for challenge games, non-recipient non-creator visitors see `Spectate`
- for open games, non-creator visitors see `Join` and `Spectate`
- remaining on the page without making an explicit selection is functionally equivalent to spectating; when the game starts, that user becomes a de facto spectator
- the popover is triggered by click/touch interaction
- the popover does not dismiss via outside click or passive dismissal
- the popover closes only when `Accept`, `Decline`, `Join`, or `Abort` is selected
- after selecting `Spectate`, the popover should stay open but replace the action buttons with `You are spectating` text and a `Cancel` button
- the `Cancel` button should return the popover to its initial action state, allowing a spectator to switch to `Join` if still possible
- the popover layout should be:
  - title
  - game info block covering settings, rules, colors, and related game metadata
  - action buttons or spectate-state controls

Pre-start game-info block content:

- the pre-start popover should reuse the same game-info content model as the in-game info popover
- it should show all relevant game settings, including board size, komi, handicap when applicable, time settings, color mode/assignment information, undo rules, ranked/unrated status, and related rule metadata
- black and white player rows should be shown using the same information model as the in-game info popover
- pre-start game-info should not show result or move-count fields

Pre-start popover start-transition behavior:

- when the game starts, the pre-start popover should disappear immediately on authoritative state sync
- no extra transition message is required when a user becomes a de facto spectator as the game starts
- a user already in the `You are spectating` popover state should remain a spectator automatically after game start
- no one-time transition feedback is required for creator or challenge recipient when the game becomes live
- if a pending join/accept action resolves at the same moment the game starts, the popover should cleanly disappear as part of the normal state transition

Challenge lifecycle:

- declining a challenge is permanent and should have the same effective terminality as aborting it
- declined challenges should remain visible as declined where declined/finished items are shown
- accepting or declining a challenge should not emit chat/system messages
- chat should lock immediately for aborted or declined games
- challenge-related unread notifications should clear on view
- decline should not generate a notification; accept may generate the normal resulting game/update notification flow
- challenges do not expire automatically

Accept/join/spectate flow:

- accept/join actions happen in-place on the game page and do not require a fresh navigation
- accept/join/decline controls should remain in spinner/pending state until the authoritative state sync resolves the action
- related notifications should clear only after the resulting state sync
- once both seats are filled, the game proceeds directly into the normal move-0 `Black to play` / `White to play` flow
- unstarted games remain a distinct pre-first-move state in one important respect: either player may still abort until the first move is played
- open/challenge popovers should distinguish between joining as a player and spectating
- users cannot join an open game as a spectator through the join action itself; spectating requires selecting the dedicated `Spectate` option in the open/challenge popover
- if a join fails because the seat was taken first, the UI should fall back to spectating rather than hard-failing the interaction

Spectate-entry behavior:

- entering as a spectator should mark the user present immediately
- spectating an unstarted, open, or challenge game should use the same overall page layout as player view, except without player-only move controls such as undo, pass, and resign
- spectating should subscribe to presence and chat immediately
- spectating via a valid invite/private token should also grant lifetime access to that game
- spectating should affect room presence/history only and should not place the game into `Your games`

Spectator-history behavior:

- spectating a game should not, by itself, add that game to profile history
- spectating a game should not affect recent-opponent or similar social-recency lists
- spectating a private game may create a persistent restricted history trace only if the spectator posted a message in that room’s chat
- there is no dedicated UI for clearing spectator-history traces

Room-history semantics:

- room history means the retained chat log plus the retained room user list for that game
- the retained room user list must always retain the players
- spectators should be retained in room history only if they posted at least one message in the room chat
- no separate per-user `rooms visited` history is required
- no separate presence-memory model is required beyond the live/current presence indicators shown at view time
- when viewing historical games, user-label presence indicators should reflect present-time live presence, not historical presence-at-the-time

#### Private and invite access

Private/invite game access should be governed by participation or possession of a valid invite token.

Expected behavior:

- visiting a private or invite-protected game without a valid token should be treated as a `403` navigation error and redirect the user to `/games` with a flash message
- a valid token grants lifetime access to that game
- private and invite-only games should be hidden from game lists for non-participants unless access has been granted through participation or token use
- a valid token is required to view or join when the game is protected
- invite links are not user-bound; any user may use a valid invite link

#### Spectator behavior

Spectators are first-class participants in the viewing/presence model even though they are not players.

Expected behavior:

- spectators may join a game at any time
- spectators count as `present` for presence-sensitive rules such as chat-lock conditions and presentation-availability logic
- spectators may use the same analysis, estimate, and presentation features as players when those features are otherwise available
- spectator-triggered activity may contribute to unread-notification behavior
- spectator presence should be visible both through presence indicators and through the room user list

#### Room user list

The game page should expose a room user list that complements chat and presence indicators.

Placement and layout:

- on mobile, the room user list should be shown in place of the chat box when the user double-taps the chat tab
- on desktop, the room user list should appear above the chat box within the same grid cell
- on desktop, the room user list should start with an initial height of `4` lines
- on desktop, a grabber between the user list and chat box should allow the user to resize the split

Membership and ordering:

- the room user list should include both players and spectators
- ordering should be: black player, white player, online friends, online users, registered users, anonymous users, most recently active, alphabetical
- offline users should remain listed if they are black or white, or if they appear in the chat history

#### Collaborative presentation

Completed games may enter collaborative presentation mode. One user 'presents' and other users 'spectate'. The presenter's analysis view (including the move tree) is synced to all spectators. The user who starts a presentation is designated the 'originator'

Expected behavior:

- entering local analysis automatically starts presentation (if there is no presentation already underway)
- initially, only players may start a presentation
- non-players may start a presentation if any of the following are true:
  - an initial presentation has already taken place and has ended
  - all players have left the game's page once (may still be online)
- starting presentation sends `start_presentation`
- ending presentation sends `end_presentation`
- presenter snapshots are sent via `presentation_state`
- spectators may still enter local analysis while a presentation is ongoing
- the client caches the latest presenter snapshot even while a viewer is temporarily in local analysis
- leaving local analysis during presentation re-syncs the board to the latest presenter snapshot (or to the default live view if the presentation has ended)
- control transfer sends `give_control`
- participants can request/take/cancel/reject control depending on capabilities
- loading a game with an active presentation automatically syncs the new spectator to the latest presentation state
- game chat remains active and functional during a presentation

Role model:

- `originator` is the user id recorded in `presentation_started.originator_id`
- `presenter` is the user currently driving the synced board state
- a non-presenting participant is either a `synced-viewer` or a `local-analysis` viewer
- `synced-viewer` means the board is driven by incoming presentation snapshots
- `local-analysis` means the viewer has temporarily branched into personal analysis and is no longer auto-importing incoming snapshots, but the latest synced snapshot is still cached for rejoin

Presentation entry and exit rules:

- when a `presentation_started` event arrives for the presenter, the client enters `presentation/presenter`, clears pending move state, restores saved analysis position, and ensures the move-tree element is attached
- when `presentation_started` arrives for a non-presenter, the client exits any active estimate/review state, saves any local analysis, enters `presentation/synced-viewer`, and imports the provided snapshot if present
- when `presentation_ended` arrives for the presenter, the client exits through normal live-analysis teardown, returning to live mode at main end
- when `presentation_ended` arrives for a `local-analysis` viewer, the client transitions to standalone analysis rather than forcing live mode
- when `presentation_ended` arrives for a `synced-viewer`, the client returns to live mode, reloads base moves, and navigates to the end position

Snapshot sync rules:

- the presenter broadcasts a fresh snapshot on board render while presentation is active
- synced viewers import each incoming `presentation_update` snapshot immediately
- local-analysis viewers do not import live presentation updates while detached, but still cache the latest snapshot
- when a synced viewer imports a presentation snapshot, the client also overwrites that game’s persisted local analysis tree with the presentation tree and active node
- leaving local analysis during an active presentation re-imports the latest cached snapshot and returns the user to `synced-viewer`

Control-transfer rules:

- only the current originator can end the presentation directly
- if the current presenter is not the originator, the presenter’s primary presentation action is `Return control`, which sends `give_control(originatorId)`
- if the originator is not currently presenting, the originator can take control immediately with `take_control`
- non-originator viewers may request control only when there is no active control request and they are not already the presenter
- a viewer with an outstanding request may cancel it with `cancel_control_request`
- only one control request may be pending at a time from the client’s point of view
- while another user’s request is pending, other non-originator viewers see a disabled pending state rather than a new request action
- when the originator sees a pending request, the UI exposes `Give control` and dismiss actions backed by `give_control(targetUserId)` and `reject_control_request()`
- on `control_changed`, the new presenter becomes `presentation/presenter`; everyone else clears pending move state, saves local analysis, becomes `presentation/synced-viewer`, and re-imports the latest cached presentation snapshot

Viewer interaction rules during presentation:

- synced viewers do not drive the shared board state
- synced viewers are shown an analysis-choice menu instead of a plain analyze button
- that menu may contain `Take control`, `Request control`, `Cancel request`, a disabled `<name> request pending` row, and `Analyze (local)` depending on role/state
- a synced viewer may always choose `Analyze (local)` to detach into personal analysis without changing presenter ownership
- presentation status text is augmented with either `(You are presenting)` or `(${presenterDisplayName} presenting)`

WebSocket presentation events must:

- enter presentation mode on `presentation_started`
- clear presentation state on `presentation_ended`
- update the synced snapshot on `presentation_update`
- update presenter/control-request signals on control-change events
- clear pending control requests on `control_changed` and `control_request_cancelled`

#### Reconnect behavior

On WebSocket reconnect:

- stale local presentation state is cleared before the server re-sends authoritative state
- the client automatically re-joins the active game room
- queued outbound messages are flushed after reconnect
- reconnect after a server restart should follow the same recovery path as any other reconnect
- stale local pending-action UI must not survive reconnect when it no longer matches authoritative server state
- live-game UI should recover from authoritative state after reconnect without requiring a manual page refresh

This prevents stale presenter UI from surviving an offline period.

Non-game reconnect behavior:

- after reconnect, non-game surfaces should resync with the server
- the lobby page should resync with the server after reconnect
- profile pages showing live-updating game history should also resync with the server after reconnect
- pending bell notifications should resync with the server after reconnect
- friend-request notifications should resync with the server after reconnect
- stale cached route data should be invalidated automatically after reconnect and refreshed from authoritative state

### `/analysis`

This route renders a standalone local analysis board with no server game room.

Expected behavior:

- document title is `Analysis Board - Seki`
- board size options are limited to `9`, `13`, and `19`
- size and komi persist in local storage
- move tree is persisted per board size
- UI preferences (move confirmation, coordinates, etc) are shared with the rest of the app

#### Analysis board interaction

- the board is fully local
- navigation across variations is supported
- pass is available when allowed by analysis capabilities
- territory review can be entered locally
- finalized territory review computes score display locally
- pending move confirmation works the same basic way as live mode when enabled
- manual stone placement plays the move sound normally
- pass plays the pass sound normally

#### Analysis metadata and panels

Player panels derive from SGF metadata when present, otherwise fallback names are `Black` and `White`.

Expected panel behavior:

- User names in panels are editable on click and persisted
- displayed clocks come from SGF move-time data when available
- otherwise panels fall back to formatted SGF time-control metadata
- captures and territory fields are updated from the current analysis node/territory result

#### SGF import

Expected import behavior:

- reads the selected file as text
- parses via the WASM SGF parser
- rejects parse errors with an alert
- rejects non-square boards with an alert
- rejects unsupported sizes with an alert
- clears prior persisted analysis tree storage for the imported size before loading
- stores parsed SGF metadata and raw SGF text in local storage
- loads the SGF tree into the engine, navigates to start, saves, and renders

#### SGF export

Expected export behavior:

- exports the current analysis tree from the engine
- includes SGF metadata from imported data when available, otherwise current analysis settings
- uses date-based filenames
- prefers `game_name` when present, otherwise falls back to player names or simply `analysis`

### `/users/:username`

This route renders a user profile page.

Data source:

- `/api/web/users/:username`

Expected behavior:

- document title is `<username> - Seki`
- all profile games render through the shared game-list item component
- profile game list paginates client-side with `Show more` in increments of 10

Realtime behavior:

- follows the same rules as the general games list page
- new games involving the profile user are inserted when enough data is available
- updates patch known games already on the page
- profile pages do not remove dismissed/aborted games from the history view

Own-profile behavior:

- shows account settings section
- unregistered users are prompted to register for advanced settings
- registered users can update username
- registered users can add/update email
- registered users can manage notification preferences
- registered users can generate or regenerate an API token
- token can be shown/hidden locally in the UI

Settings/profile edit behavior:

- profile/settings updates should save immediately when the relevant action is taken
- multiple settings forms or controls may have simultaneous pending states
- state changes resulting from a successful update should trigger appropriate component re-renders wherever the changed data is visible
- username changes should update visible labels immediately after the successful update
- token generation and regeneration should require confirmation

API-token behavior:

- API tokens should be hidden by default
- regenerating a token should invalidate the previous token immediately, unless and until multi-token support exists
- the token UI should support copy-to-clipboard behavior
- users without token access should see no token UI rather than a disabled token section
- token actions should be available on mobile with the same behavior as on desktop

When the current user is on their own registered profile page, the notification settings table must expose:

- your turn
- your turn (correspondence)
- new challenge
- new message
- incoming friend requests

For each row:

- in-app toggle is always available
- email toggle is disabled until the user has an email address saved

Other-user behavior:

- shows a `Challenge` button linking to `/games/new?opponent=<username>`
- shows a `Add friend` button (not yet implemented)
- on other-user profiles of registered users, the friend action should appear next to the display name
- if the users are already friends, the profile should show a `Remove friend` button instead
- both `Add friend` and `Remove friend` actions should require confirmation dialogs
- if a friendship request is pending, the profile should show a disabled pending-state button in the same location
- only registered users may send or receive friend requests
- duplicate friend requests should not be allowed

Form submission behavior:

- profile settings submit through SPA form handlers
- username update form should only trigger browser credentials update dialogue on submission, not navigation
- successful updates refresh session state
- redirects returned by the server are followed via SPA navigation
- errors are shown as flash messages

### `/login` and `/register`

These routes render SPA auth forms for guests.

Expected behavior:

- registered users navigating to these routes are redirected to `/`
- login supports an optional `redirect` query parameter and preserves it through submit
- validation is primarily server-driven, with basic required/min-length HTML constraints
- server errors are shown inline as flash messages
- successful auth refreshes session state and follows the server redirect

### `/settings`

This route is not a standalone screen.

Expected behavior:

- redirect to `/users/:currentDisplayName`
- preserve `error` query state by forwarding it onto the profile URL

### Not-found routes

Unknown routes render a simple `Page not found.` error state.

## Notification Behavior

### In-app unread tracking

Unread tracking is game-based.

Expected behavior:

- unread games feed the nav bell state
- opening or explicitly marking a game as read clears its unread marker
- live route state-sync marks the current game as read

### OS notifications

Expected behavior:

- only exposed when the Notification API exists
- permission denial is reflected in bell/settings UI
- users can toggle OS notifications from both the bell dropdown and settings page

### Notification policy

Notification behavior should distinguish between bell notifications, per-game unread indicators, OS notifications, and document-title attention states.

Turn notifications:

- bell notifications for a turn should appear only if the relevant game is not currently open in the current tab
- turn notifications should fire only for newly reached turns, not on initial page load or state hydration
- OS notifications for turns should fire only when the tab is inactive
- document-title flashing for turns should happen only when the tab is inactive

Chat notifications:

- bell notifications for chat should appear only if the relevant game is not currently open in the current tab
- on mobile layouts, the game tab bar should show a chat/unread indicator for as long as that game has unread chat messages

Suppression rules:

- no notifications should be generated for pending/local optimistic messages
- presentation mode should not itself generate notifications
- analysis mode should not itself generate notifications

Cross-tab behavior:

- bell notifications are tab-contextual and may legitimately differ across tabs or devices
- bell notifications should still sync with updates originating from other tabs
- an unread turn/game notification should be visible in any tab that is not currently on the relevant game
- unread notifications for a game should be dismissed across tabs when that game is viewed or when the relevant action clears the unread condition, such as playing the move

## Error Handling Expectations

The frontend currently favors simple failure behavior.

Expected patterns:

- route fetch failures render a plain error paragraph
- form POST failures surface returned messages inline
- SGF import failures use `alert`
- rematch failures use `alert`
- best-effort preference saves fail silently
- malformed WebSocket payloads are ignored with console logging
- unknown WebSocket kinds are ignored with console warnings

### Navigation errors vs fetch errors

Navigation errors and fetch-action errors should be handled differently.

Navigation errors:

- failed page navigations should generally redirect rather than leave the user on a broken destination screen
- the redirect target and flash message should depend on the failed request
- a missing game route such as `/games/124` should redirect to `/games` with a message like `The game you were looking for (ID 124) does not exist`
- a general not-found route such as `/foo` should redirect to `/` with a message indicating the page does not exist
- authorization failures during navigation should redirect with a clear message such as `You are not authorized to view this page`

Fetch/action errors:

- validation-style `422` responses should surface inline UI feedback in the relevant form or control
- server-side `5xx` responses should surface visible UI feedback rather than fail silently

Auth failures:

- any `401` response, whether from navigation or a follow-up fetch/action, should redirect to the login page
- when possible, the login redirect should preserve a return target back to the page or action context that triggered the failure

Capability assumptions:

- `403` responses should be rare in normal UI flows because the frontend should already reflect the user’s allowed capabilities for the current state

### Flash messages

Flash messages are the standard user-visible mechanism for navigation redirects and many recoverable errors.

Expected behavior:

- flash messages should render as full-width banners directly beneath the global nav bar
- flash messages should overlay the `<main>` area rather than shifting page layout
- flash messages should not persist across subsequent navigations
- flash messages should be dismissible by pointer action
- the same flash-message mechanism should be shared by SPA navigations and full page reloads
- flash banners have the highest visual precedence and should appear above other content, including popovers

Severity levels:

- `error` uses `var(--red)`
- `warning` uses `var(--yellow)`
- `success` uses `var(--green)`
- `info` uses `var(--aqua)`

### Optimistic UI and pending actions

User actions should provide immediate pending-state feedback rather than appearing inert while the server responds.

General rules:

- actions that require server confirmation should enter a visible pending state immediately after user activation
- pending controls should show a spinner in the relevant button/control
- pending controls should be disabled until the server confirms or rejects the action
- where a pair or group of mutually exclusive actions is shown together, all related controls should be disabled while the action is pending
- pending UI should resolve only from authoritative server confirmation or failure handling

Expected behavior by action:

- sending chat: the new message should appear in chat immediately in a muted/pending style, then resolve to normal appearance when the server confirms it
- sending chat: pending local chat messages should not survive navigation or reload
- sending chat: a transport reconnect may retry the pending local message while the user remains on the same page
- requesting undo: the confirm/cancel UI should show a spinner, and both controls should be disabled until server confirmation; then the dialog should dismiss
- accepting undo: the undo-response UI should show a spinner, and both accept/reject controls should be disabled until server confirmation; then the dialog should dismiss
- rejecting undo: the undo-response UI should show a spinner, and both reject/accept controls should be disabled until server confirmation; then the dialog should dismiss
- accepting territory: the accept control should show a spinner and remain disabled until the server confirms the action
- presentation actions: start/end/request/take/cancel/give/reject control actions should show a spinner in the active button while pending
- joining/open-seat actions should show a spinner in the active button while pending
- challenge actions should show a spinner in the active button while pending
- abort game should show a spinner in the active button while pending
- the same disabled-button spinner pattern should apply broadly to similar server-confirmed actions unless there is a clearer interaction model for that specific control

Pending-action failure recovery:

- if a pending action is rejected or fails, the spinner should revert immediately back to the prior control state
- dialogs associated with the failed action should remain open after the failure
- pending-action failures should surface through flash messaging
- recoverable failures should allow immediate retry
- failed chat sends should remove their pending local entry rather than converting into a restored draft
- some failures may transition the UI into a different valid state instead of showing a simple error, for example a failed join due to a race resolving into spectating

### Confirmation dialogs and popovers

Confirmation UI should have a consistent appearance and interaction model even if the underlying implementation uses popovers, dialogs, or another mechanism.

Expected behavior:

- confirmation popovers/dialogs should share a common visual layout
- destructive actions should use stronger/destructive styling, for example a red abort-game action
- confirmation UIs may include extra options where needed, such as rematch configuration
- confirm/cancel button ordering should be consistent across all confirmation UIs
- the specific underlying primitive does not matter as long as the visible presentation and interaction are consistent

## Non-Goals and Current Constraints

These are current behavioral constraints, not bugs in this spec:

- the standalone analysis board only supports square 9x9, 13x13, and 19x19 boards
- imported profile-game updates that were not already in the page dataset are not fully reconstructible if required fields are missing from the update payload
- much of the visible control availability is capability-derived and therefore intentionally state-dependent rather than route-static
- some UX feedback still relies on browser-native `alert`

## Reference Sources

This spec is informed by the current frontend implementation, primarily:

- [`seki-web/frontend/src/app.tsx`](/var/home/sqwxl/Projects/seki/seki-web/frontend/src/app.tsx)
- [`seki-web/frontend/src/layouts/live-game.tsx`](/var/home/sqwxl/Projects/seki/seki-web/frontend/src/layouts/live-game.tsx)
- [`seki-web/frontend/src/layouts/analysis.tsx`](/var/home/sqwxl/Projects/seki/seki-web/frontend/src/layouts/analysis.tsx)
- [`seki-web/frontend/src/game/state.ts`](/var/home/sqwxl/Projects/seki/seki-web/frontend/src/game/state.ts)
- [`seki-web/frontend/src/game/messages.ts`](/var/home/sqwxl/Projects/seki/seki-web/frontend/src/game/messages.ts)
- [`seki-web/frontend/src/game/capabilities.ts`](/var/home/sqwxl/Projects/seki/seki-web/frontend/src/game/capabilities.ts)
- [`seki-web/frontend/src/ws.ts`](/var/home/sqwxl/Projects/seki/seki-web/frontend/src/ws.ts)

If implementation and this document diverge, this document defines the intended frontend behavior.
