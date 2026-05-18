# Quickstart: UserLabel UserData Refactor

## Implementation Order

1. Rework `seki-web/frontend/src/components/user-label.tsx` so its public API takes structured user data plus explicit context options and explicit fallback state.
2. Update direct component callers that already have `UserData`, including player panels, game descriptions, lobby popovers, and the user menu.
3. Resolve TODO/FIXME sites:
   - `components/user-label.tsx`: presence visibility should be an option, not implied by a raw online prop.
   - `components/chat.tsx`: replace placeholder message user data with real structured data or an explicit fallback.
   - `layouts/form-variants/shared.tsx`: ensure challenge search and recent opponent labels receive complete `UserData`.
4. Fix first-party screen data contracts where a real displayed user is still represented only by primitives.
5. Add or update focused frontend tests for label rendering options and fallback behavior if a test harness already covers nearby component/state logic.
6. Run verification commands.

## Verification

From `seki-web/frontend/`:

```bash
pnpm run typecheck
pnpm test
pnpm run build
```

From repository root, only if Rust web response shapes change:

```bash
cargo test -p seki-web
```

## Manual Checks

- Player panels show stone, display name, rank, and presence according to the frontend spec.
- Game lists and game descriptions preserve black/white label behavior.
- Chat sender labels show player stones for known black/white users and use explicit fallback for system or unknown senders.
- Challenge user search shows full user-label presentation minus stone icon.
- Current user menu still links to the correct profile and displays rank according to the active rating display preference.
