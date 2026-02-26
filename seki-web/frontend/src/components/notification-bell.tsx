import { render } from "preact";
import { useState, useEffect, useRef } from "preact/hooks";
import { unreadGames, hasUnread, markRead } from "../game/unread";
import { ToggleButton } from "./toggle-button";
import { IconBell, IconBellDisabled, IconBellUnread } from "./icons";
import { storage, NOTIFICATIONS } from "../utils/storage";

function isNotifSupported(): boolean {
  return "Notification" in window;
}

function isNotifEnabled(): boolean {
  return (
    isNotifSupported() &&
    storage.get(NOTIFICATIONS) === "on" &&
    Notification.permission === "granted"
  );
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

function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [notifOn, setNotifOn] = useState(isNotifEnabled);
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

  async function handleToggleNotifications() {
    if (!isNotifSupported()) {
      return;
    }
    if (Notification.permission === "denied") {
      return;
    }
    if (Notification.permission === "default") {
      const result = await Notification.requestPermission();
      if (result !== "granted") {
        setNotifOn(false);
        return;
      }
    }
    const next = storage.get(NOTIFICATIONS) === "on" ? "off" : "on";
    storage.set(NOTIFICATIONS, next);
    setNotifOn(next === "on" && Notification.permission === "granted");
  }

  const games = [...unreadGames.value.values()];

  return (
    <div class="notification-bell" ref={ref}>
      <button
        type="button"
        class="nav-icon"
        title={hasUnread.value ? "You have unread games" : "Notifications"}
        onClick={() => setOpen(!open)}
      >
        <BellIcon />
      </button>
      {open && (
        <div class="notification-dropdown">
          {games.length > 0 ? (
            <ul>
              {games.map((g) => {
                const label = gameLabel(g);
                return (
                  <li key={g.id}>
                    <a
                      href={`/games/${g.id}`}
                      onClick={() => {
                        markRead(g.id);
                        setOpen(false);
                      }}
                    >
                      {label}
                    </a>
                  </li>
                );
              })}
            </ul>
          ) : (
            <div class="notification-dropdown-empty">No unread games</div>
          )}
          {isNotifSupported() && (
            <div class="notification-dropdown-footer">
              <ToggleButton
                on={notifOn}
                label="OS notifications"
                onToggle={handleToggleNotifications}
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
