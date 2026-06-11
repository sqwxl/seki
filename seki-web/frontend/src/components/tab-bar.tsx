import type { ComponentChildren } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { hasUnreadChat, mobileTab } from "../game/state";
import {
  IconAnalysis,
  IconChat,
  IconChatUnread,
  IconMenu,
  IconStonesBw,
} from "./icons";

type Tab = "board" | "chat" | "analysis";

const tabs: { id: Tab; label: string }[] = [
  { id: "board", label: "Board" },
  { id: "chat", label: "Chat" },
  { id: "analysis", label: "Analysis" },
];

function TabIcon({ id }: { id: Tab }) {
  if (id === "board") {
    return <IconStonesBw />;
  }

  if (id === "chat") {
    return hasUnreadChat.value ? <IconChatUnread /> : <IconChat />;
  }

  if (id === "analysis") {
    return <IconAnalysis />;
  }

  return null;
}

export function ControlsMenu({ children }: { children: ComponentChildren }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

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

  return (
    <div class="controls-menu" ref={ref}>
      <button
        type="button"
        title="More controls"
        onClick={() => setOpen(!open)}
      >
        <IconMenu />
      </button>
      {open && <div class="controls-menu-dropdown">{children}</div>}
    </div>
  );
}

export function TabBar() {
  const current = mobileTab.value;

  return (
    <div class="mobile-tab-bar">
      {tabs.map((t) => (
        <button
          key={t.id}
          aria-pressed={current === t.id ? "true" : "false"}
          title={t.label}
          onClick={() => {
            mobileTab.value = t.id;
            if (t.id === "chat") {
              hasUnreadChat.value = false;
            }
          }}
        >
          <TabIcon id={t.id} />
        </button>
      ))}
    </div>
  );
}
