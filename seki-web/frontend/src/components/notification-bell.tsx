import { render } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { unreadGames, hasUnread, markRead } from "../game/unread";
import { ToggleButton } from "./toggle-button";
import { IconBell, IconBellDisabled, IconBellUnread } from "./icons";
import {
  osNotificationsEnabled,
  toggleOsNotifications,
} from "../utils/os-notifications";

function isNotifSupported(): boolean {
  return "Notification" in window;
}

function BellIcon() {
  if (hasUnread.value) {
    return <IconBellUnread />;
  }
  if (isNotifSupported() && Notification.permission === "denied") {
    return <IconBellDisabled />;
  }
  return <IconBell />;
}

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on click outside
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

  const games = [...unreadGames.value.values()];

  return (
    <div class="nav-dropdown-wrapper" ref={ref}>
      <button
        type="button"
        class="nav-icon"
        title={hasUnread.value ? "You have unread games" : "Notifications"}
        onClick={() => setOpen(!open)}
      >
        <BellIcon />
      </button>
      {open && (
        <div class="nav-dropdown">
          <div class="nav-dropdown-section">
            {games.length > 0 ? (
              games.map((g) => {
                const label = gameLabel(g);
                return (
                  <a
                    key={g.id}
                    class="nav-dropdown-item"
                    href={`/games/${g.id}`}
                    onClick={() => {
                      markRead(g.id);
                      setOpen(false);
                    }}
                  >
                    {label}
                  </a>
                );
              })
            ) : (
              <span class="nav-dropdown-item nav-dropdown-empty">
                No unread games
              </span>
            )}
          </div>
          {isNotifSupported() && (
            <div class="nav-dropdown-section">
              <ToggleButton
                on={osNotificationsEnabled.value}
                label="OS notifications"
                onToggle={toggleOsNotifications}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function gameLabel(g: {
  id: number;
  stage: string;
  black?: { display_name: string };
  white?: { display_name: string };
}): string {
  const b = g.black?.display_name ?? "?";
  const w = g.white?.display_name ?? "?";
  if (g.stage === "challenge") {
    return `Challenge: ${b} vs ${w}`;
  }
  return `Your turn: ${b} vs ${w}`;
}

export function initNotificationBell(): void {
  const root = document.getElementById("notification-bell");
  if (!root) {
    return;
  }
  render(<NotificationBell />, root);
}
