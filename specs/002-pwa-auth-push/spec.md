# Feature Specification: PWA Auth and Push

**Development Branch**: `main` unless explicitly requested otherwise

**Created**: 2026-05-16

**Status**: Draft

**Input**: User description: "Add PWA functionality so users can install Seki as a standalone web app from mobile Chrome/Firefox. Installed app sessions currently are not persisted by the sandboxed webview, so users must log in each time the app is opened or refreshed. The application should move browser app authentication away from browser-managed session persistence, define standard install metadata, add offline-capable app behavior, and support push notifications by storing push delivery destinations server-side per session so notifications no longer rely only on an active live connection."

## Source References *(mandatory)*

- README.md Features: `Turn notifications (email/push)` is unchecked; `Notification settings and OS notification toggle` and `Login/logout with session persistence` are checked but do not cover installed standalone app persistence.
- FRONTEND_SPEC.md Product Boundaries: browser client owns route UI, local state, live connection, endpoint calls, and browser-local preferences; authentication decisions and notification delivery remain server responsibilities.
- FRONTEND_SPEC.md Guest and session identity behavior: anonymous users are session-backed identities and registration preserves the same user id and game history.
- FRONTEND_SPEC.md OS notifications and Notification policy: OS notifications are user-controlled, permission denial is reflected in UI, and turn/chat notification suppression rules already distinguish tab state and unread state.
- FRONTEND_SPEC.md Auth failures: `401` responses redirect to login while preserving the return target where possible.
- API_SPEC.md Access Control: private and invite-protected games must not leak through APIs or WebSocket clients that bypass the browser UI.
- API_SPEC.md Abuse Controls: login, registration, game creation, and WebSocket attempts are rate limited; new notification subscription and authentication flows must fit the same abuse-control expectations.

## Clarifications

### Session 2026-05-16

- Q: What lifetime should browser app credentials use for installed app identity continuity? → A: Rolling 90-day lifetime, renewed during active use.
- Q: Which notification event types should push notifications support? → A: All account-level notification types: your turn, correspondence turn, new challenge, new message, incoming friend requests.
- Q: Should anonymous users be eligible for push notifications? → A: Registered and anonymous users; anonymous push uses browser-local opt-in defaults.
- Q: How should duplicate push notifications be suppressed when Seki is already active? → A: Suppress push only for destinations with an active foreground Seki client; other opted-in destinations can still receive push.
- Q: What detail level should push notification content use for authorized recipients? → A: Include detailed text whenever the recipient is authorized.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Stay signed in when installed (Priority: P1)

A registered or anonymous user installs Seki from a supported mobile browser and expects the standalone app to remember their identity when they close, reopen, or refresh it.

**Why this priority**: The main current PWA limitation is that installed-app sessions do not survive the standalone webview lifecycle, making the app feel broken for mobile users.

**Independent Test**: Install Seki from a supported mobile browser, sign in or continue as an anonymous user, close the standalone app, reopen it, refresh a page, and confirm the same user identity, preferences, and accessible games remain available without another login.

**Acceptance Scenarios**:

1. **Given** a registered user has logged in through the installed app, **When** they close and reopen the standalone app, **Then** they remain logged in and land on the expected route.
2. **Given** an anonymous user has created or joined a game in the installed app, **When** they refresh the app or relaunch it, **Then** the same anonymous identity and prior game access are preserved.
3. **Given** an installed-app credential is invalid, expired, revoked, or missing, **When** the user opens a protected route, **Then** the app redirects to login with the intended destination preserved and does not expose protected content.

---

### User Story 2 - Install Seki as a standalone app (Priority: P2)

A mobile user opens Seki in Chrome or Firefox and can install it as a standalone app with a recognizable name, icon, launch URL, display mode, and theme presentation.

**Why this priority**: A predictable install experience is the foundation for treating Seki as a mobile app rather than a website tab.

**Independent Test**: Visit Seki on supported mobile browsers and verify the install affordance is available, the installed app launches outside the browser chrome, and the app opens into a usable first screen with correct identity handling.

**Acceptance Scenarios**:

1. **Given** a user visits Seki on a supported mobile browser, **When** the browser evaluates installability, **Then** Seki satisfies the browser's install requirements.
2. **Given** Seki is installed, **When** the user launches it from the home screen, **Then** it opens in standalone app presentation with Seki branding and a valid start destination.
3. **Given** the app is launched without network connectivity, **When** no fresh game data can be reached, **Then** the app shows a clear offline state rather than a broken or blank screen.

---

### User Story 3 - Receive push notifications without an open tab (Priority: P3)

A user who opts into notifications can receive important game notifications even when no Seki tab or live connection is active.

**Why this priority**: Current real-time notifications depend on an active connection. Push support makes turn, challenge, chat, and friend-request notifications useful for mobile and correspondence play.

**Independent Test**: Enable notifications, close all active Seki tabs and standalone app windows, trigger a notification-worthy event from another account, and verify a system notification reaches the opted-in user according to their preferences.

**Acceptance Scenarios**:

1. **Given** a user has granted notification permission and enabled Seki notifications for a supported event type, **When** a notification-worthy event occurs while no Seki live connection is active for that user, **Then** the user receives a system notification.
2. **Given** a user disables OS notifications or revokes browser permission, **When** notification-worthy events occur, **Then** no push notification is sent to that disabled destination.
3. **Given** a user taps a delivered notification, **When** the app opens, **Then** it navigates to the relevant game, chat, challenge, or request context and applies the same read/clear behavior as in-app notifications.
4. **Given** an anonymous user grants notification permission and enables Seki notifications in the browser, **When** a supported notification-worthy event occurs for that anonymous identity, **Then** the user can receive a push notification according to browser-local opt-in state.

### Edge Cases

- Installed-app identity is cleared locally by the user or browser storage policy.
- Installed-app identity is unused for more than 90 days and expires.
- A user changes password, logs out, or otherwise invalidates existing app credentials.
- A registered user has multiple installed devices and browser profiles.
- An anonymous user installs the app, uses it for games, and later registers.
- Notification permission is denied, later granted, or revoked outside Seki.
- A stored notification destination becomes invalid, expired, duplicated, or belongs to a logged-out session.
- A private or invite-only game notification is generated for a user who is no longer authorized to view it.
- The device is offline when a push notification arrives or when the user taps it.
- Multiple tabs and the installed app are open at the same time for the same user.
- One destination is actively using Seki in the foreground while another opted-in destination for the same user has no active foreground client.
- An authorized recipient receives a push notification for a private or invite-only game.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST allow supported mobile browsers to recognize Seki as installable with a consistent app name, icon set, launch destination, display mode, and visual theme metadata.
- **FR-002**: System MUST launch installed Seki sessions into a usable standalone app experience without relying on browser tab chrome.
- **FR-003**: System MUST persist browser app identity across standalone app relaunches and refreshes for registered users.
- **FR-004**: System MUST persist anonymous user identity across standalone app relaunches and refreshes so prior game access and registration upgrade behavior are preserved.
- **FR-005**: System MUST provide a secure logout path that invalidates the current browser app identity for the device where logout occurs.
- **FR-006**: System MUST reject invalid, expired, revoked, malformed, or unauthorized app credentials without exposing protected game, message, profile, or preference data.
- **FR-007**: System MUST preserve existing access-control rules for public, private, and invite-protected games for installed app users, browser tab users, and clients that bypass the UI.
- **FR-008**: System MUST keep registered users from being forced to log in again during normal standalone app relaunches unless their credential has been inactive for 90 days, expired, been revoked, or been cleared locally.
- **FR-009**: System MUST expose notification opt-in, opt-out, and permission-state feedback consistently from the notification bell and settings surfaces.
- **FR-010**: System MUST allow users to register the current browser/app session as a push notification destination after permission is granted.
- **FR-011**: System MUST store push notification destinations per user session or device so one user can receive notifications on multiple opted-in devices and can stop notifications for a specific device/session.
- **FR-011a**: System MUST support push notification destinations for both registered and anonymous users; anonymous user push eligibility MUST use browser-local opt-in state because account-level notification preferences are unavailable.
- **FR-012**: System MUST remove or disable push destinations that are logged out, revoked, expired, rejected by the push provider, or no longer associated with an authorized user session.
- **FR-013**: System MUST send push notifications for enabled your-turn, correspondence-turn, new-challenge, new-message, and incoming-friend-request notifications when the user is eligible and no active live connection or tab is required to deliver the notification. *(Note: incoming-friend-request push dispatch stub is included in this feature; actual friend-request events will be wired when the friend-request feature is implemented.)*
- **FR-014**: System MUST apply existing notification preferences and suppression rules to push notifications, including event type settings for your turn, correspondence turn, new challenge, new message, and incoming friend requests, and avoiding notifications caused by the user's own local optimistic actions.
- **FR-014a**: System MUST suppress push notifications only for destinations that currently have an active foreground Seki client; other opted-in destinations for the same user remain eligible for push delivery.
- **FR-015**: System MUST include detailed push notification content whenever the recipient is authorized to view the underlying game or event, and MUST avoid revealing private game details to unauthorized recipients.
- **FR-016**: System MUST open the relevant destination when the user activates a delivered notification and reconcile unread/read state from authoritative server state.
- **FR-017**: System MUST provide an offline-capable app shell state so installed users see meaningful navigation or retry feedback when the network is unavailable.
- **FR-018**: System MUST preserve existing real-time behavior for users who have an active tab or installed app window open.

### Contract and Boundary Requirements *(include when applicable)*

- **CB-001**: Browser app authentication MUST work in standalone app contexts where browser-managed session persistence is unavailable or unreliable.
- **CB-002**: Browser-local presentation preferences remain browser-local unless an existing account-level preference already owns the value.
- **CB-003**: Anonymous identity continuity remains a server-owned identity guarantee; browser storage only proves continuity for the current app/device.
- **CB-004**: Push subscription registration, replacement, revocation, and delivery authorization MUST be enforced server-side and MUST require the same user identity that owns the destination.
- **CB-005**: Push delivery MUST be treated as an additional notification channel, not as a replacement for in-app unread state, bell notifications, live updates, or email preferences.
- **CB-006**: External client authentication credentials remain separate from browser app identity credentials unless a future spec explicitly merges them.

### Key Entities *(include if feature involves data)*

- **Browser App Credential**: A device/browser-held proof of the current Seki identity, used to restore registered or anonymous sessions in installed and tabbed browser contexts, with a rolling 90-day lifetime renewed during active use.
- **Push Destination**: A user/session/device-specific destination for system notification delivery, including permission status, enabled state, lifecycle timestamps, and provider validity state.
- **Installed App Manifest Metadata**: The app name, icons, launch destination, display mode, orientation/theme hints, and related metadata browsers use to install and launch Seki.
- **Notification Delivery Event**: A notification-worthy event evaluated against user preferences, authorization, active connection state, and destination availability.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 95% of installed-app relaunches by users with valid stored app identity restore the same Seki identity without a manual login.
- **SC-001a**: Valid installed-app identities used at least once every 90 days continue without a manual login until logout, revocation, local clearing, or inactivity expiry.
- **SC-002**: Supported mobile browsers offer Seki as installable and launch it in standalone presentation in standard installability checks.
- **SC-003**: A user can install Seki, sign in, close the app, reopen it, and reach their games list in under 10 seconds on a typical mobile connection.
- **SC-004**: *(Post-launch monitoring metric; not verifiable during implementation.)* 95% of eligible push notifications for opted-in users are accepted for delivery within 30 seconds of the triggering event when the push provider is reachable.
- **SC-005**: Users who disable notifications or revoke permission receive zero further push notifications for that disabled destination after the change is processed.
- **SC-006**: Private or invite-only notification tests expose no protected game details to unauthorized users across browser UI, standalone app launch, and notification activation flows.
- **SC-007**: Existing in-app notification and real-time flows continue to pass their current acceptance tests after PWA auth and push support are added.

## Assumptions

- Mobile Chrome and Firefox are the initial target browsers for installability and standalone use.
- Seki will support installed app behavior for both registered users and anonymous users because anonymous play is already a core workflow.
- Anonymous users can opt into push notifications from the current browser/app, but they do not receive account-level cross-device preference management until they register.
- Push notification content will be concise and may use generic wording when revealing detailed game information would risk exposing protected content.
- Authorized recipients may see detailed push content; unauthorized recipients or public lock-screen contexts must not reveal private game details.
- Push notification delivery depends on user permission, browser support, device connectivity, and provider availability; Seki is responsible for registering, attempting, and cleaning up delivery destinations.
- Offline support is limited to a meaningful app shell and recovery state for this feature; offline gameplay, move submission, and full data synchronization are out of scope.
- Existing account-level notification preferences continue to decide which event types are eligible for notification.
- Existing external-client token management remains unchanged.
