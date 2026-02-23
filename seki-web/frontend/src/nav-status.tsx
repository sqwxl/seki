import { render } from "preact";
import { useEffect, useState } from "preact/hooks";
import { IconLogin, IconLogout, IconOffline } from "./icons";
import { UserLabel } from "./user-label";
import { onStatusChange } from "./live";
import type { UserData } from "./goban/types";

type NavStatusProps = {
  user: UserData;
};

function handleLogout() {
  fetch("/logout", { method: "POST" }).then(() => {
    window.location.replace("/");
  });
}

function NavStatus({ user }: NavStatusProps) {
  const [connected, setConnected] = useState(true);

  useEffect(() => {
    onStatusChange(setConnected);
  }, []);

  return (
    <>
      {!connected && (
        <span class="nav-icon" title="Connection lost — reconnecting…">
          <IconOffline />
        </span>
      )}
      <button
        id="notification-toggle"
        type="button"
        title="Enable turn notifications"
      />
      <UserLabel
        name={user.display_name}
        profileUrl={`/users/${user.display_name}`}
      />
      {user.is_registered ? (
        <button
          type="button"
          class="nav-icon"
          title="Log out"
          onClick={handleLogout}
        >
          <IconLogout />
        </button>
      ) : (
        <>
          <a href="/login" class="nav-icon" title="Log in">
            <IconLogin />
          </a>
          <a href="/register">Register</a>
        </>
      )}
    </>
  );
}

export function renderNavStatus(el: HTMLElement, user: UserData): void {
  render(<NavStatus user={user} />, el);
}
