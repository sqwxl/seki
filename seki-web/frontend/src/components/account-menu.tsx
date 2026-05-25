import type { UserData } from "../game/types";
import { ratingDisplayPreference } from "../utils/preferences";
import { authUrl } from "../utils/spa-navigation";
import { IconLogout } from "./icons";
import { UserLabel } from "./user-label";

export function AccountLinks({
  user,
  onLogout,
}: {
  user?: UserData;
  onLogout?: () => void | Promise<void>;
}) {
  const username = user?.display_name ?? "Guest";
  const isRegistered = user?.is_registered ?? false;

  return (
    <>
      <a class="user-menu-trigger" href={`/users/${username}`}>
        {user ? (
          <UserLabel
            user={user}
            noLink
            options={{ rank: { displayMode: ratingDisplayPreference.value } }}
          />
        ) : (
          "Guest"
        )}
      </a>
      {isRegistered ? (
        <button
          type="button"
          class="nav-icon"
          onClick={() => onLogout?.()}
          title="Log out"
        >
          <IconLogout />
        </button>
      ) : (
        <>
          <a href={authUrl("login")}>Log in</a>
          <a href={authUrl("register")}>Register</a>
        </>
      )}
    </>
  );
}
