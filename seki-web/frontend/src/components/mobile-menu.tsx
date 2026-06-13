import { useEffect, useRef, useState } from "preact/hooks";
import type { UserData } from "../game/types";
import { ratingDisplayPreference } from "../utils/preferences";
import { authUrl } from "../utils/spa-navigation";
import {
  IconAnalysis,
  IconBot,
  IconLogin,
  IconLogout,
  IconPlus,
  IconPublic,
  IconRegister,
  IconSettings,
  IconUser,
} from "./icons";
import { SettingsDropdownContent } from "./settings-menu";
import { UserLabel } from "./user-label";

export function MobileMenu({
  user,
  onLogout,
}: {
  user?: UserData;
  onLogout?: () => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const username = user?.display_name ?? "Guest";
  const isRegistered = user?.is_registered ?? false;
  const showNavigation = !user?.is_bot;

  useEffect(() => {
    if (!open) {
      return;
    }

    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }

    document.addEventListener("click", onClickOutside, true);

    return () => document.removeEventListener("click", onClickOutside, true);
  }, [open]);

  async function handleLogout() {
    setOpen(false);
    await onLogout?.();
  }

  return (
    <div class="nav-dropdown-wrapper mobile-menu-wrapper" ref={ref}>
      <button
        type="button"
        class="nav-icon"
        onClick={() => setOpen(!open)}
        title="Menu"
        aria-expanded={open}
      >
        {user ? (
          <UserLabel
            user={user}
            noLink
            options={{
              rank: { displayMode: ratingDisplayPreference.value },
            }}
          />
        ) : (
          <>
            <IconUser /> Guest
          </>
        )}
      </button>
      {open && (
        <div class="nav-dropdown mobile-menu-dropdown">
          {showNavigation && (
            <div class="nav-dropdown-section">
              <a
                class="nav-dropdown-item"
                href="/games/new"
                onClick={() => setOpen(false)}
              >
                <IconPlus /> New game
              </a>
              <a
                class="nav-dropdown-item"
                href="/games/spectate"
                onClick={() => setOpen(false)}
              >
                <IconPublic /> Spectate
              </a>
              <a
                class="nav-dropdown-item"
                href="/bot"
                onClick={() => setOpen(false)}
              >
                <IconBot /> Bot Practice
              </a>
              <a
                class="nav-dropdown-item"
                href="/analysis"
                onClick={() => setOpen(false)}
              >
                <IconAnalysis /> Analysis Board
              </a>
              <a
                class="nav-dropdown-item"
                href="/players"
                onClick={() => setOpen(false)}
              >
                <IconUser /> Players
              </a>
            </div>
          )}
          <SettingsDropdownContent showLabel={false} />
          <div class="nav-dropdown-section">
            <a
              class="nav-dropdown-item"
              href={`/users/${username}`}
              onClick={() => setOpen(false)}
            >
              <IconSettings /> Profile
            </a>
            {isRegistered ? (
              <button
                type="button"
                class="nav-dropdown-item"
                onClick={handleLogout}
              >
                <IconLogout /> Log out
              </button>
            ) : (
              <>
                <a
                  class="nav-dropdown-item"
                  href={authUrl("login")}
                  onClick={() => setOpen(false)}
                >
                  <IconLogin /> Log in
                </a>
                <a
                  class="nav-dropdown-item"
                  href={authUrl("register")}
                  onClick={() => setOpen(false)}
                >
                  <IconRegister /> Register
                </a>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
