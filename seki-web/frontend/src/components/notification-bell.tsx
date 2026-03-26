import { useEffect, useRef, useState } from "preact/hooks";
import { unreadGames, hasUnread, markRead } from "../game/unread";
import { ToggleButton } from "./toggle-button";
import { IconBell, IconBellDisabled, IconBellUnread } from "./icons";
import { readUserData } from "../game/util";
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

export function gameLabel(g: {
  id: number;
  creator_id?: number;
  stage: string;
  black?: { id: number; display_name: string };
  white?: { id: number; display_name: string };
}): string {
  const b = g.black?.display_name ?? "?";
  const w = g.white?.display_name ?? "?";
  if (g.stage === "challenge") {
    const creatorName = resolveCreatorName(g);
    return `Challenge from ${creatorName}`;
  }
  return `Your turn: ${b} vs ${w}`;
}

function resolveCreatorName(g: {
  creator_id?: number;
  black?: { id: number; display_name: string };
  white?: { id: number; display_name: string };
}): string {
  const currentUserId = readUserData()?.id;
  if (g.creator_id != null) {
    if (g.black?.id === g.creator_id) {
      return g.black.display_name;
    }
    if (g.white?.id === g.creator_id) {
      return g.white.display_name;
    }
  }

  if (currentUserId != null) {
    if (g.black?.id === currentUserId && g.white?.display_name) {
      return g.white.display_name;
    }
    if (g.white?.id === currentUserId && g.black?.display_name) {
      return g.black.display_name;
    }
  }

  return g.black?.display_name ?? g.white?.display_name ?? "?";
}
