import type { Signal } from "@preact/signals";
import { hasUnreadChat } from "../game/state";
import { IconChatUnread } from "./icons";

export type TabDef = {
  id: string;
  label: string;
  icon: preact.ComponentType<{ title?: string }>;
};

export function TabBar(props: {
  tabs: TabDef[];
  active: Signal<string>;
  unreadTabId?: string;
  onSelect?: (id: string) => void;
}) {
  return (
    <div class="mobile-tab-bar">
      {props.tabs.map((t) => {
        const isActive = props.active.value === t.id;
        const unread = props.unreadTabId === t.id && hasUnreadChat.value;
        const Icon = unread ? IconChatUnread : t.icon;

        return (
          <button
            key={t.id}
            aria-pressed={isActive ? "true" : "false"}
            title={t.label}
            onClick={() => {
              props.active.value = t.id;
              props.onSelect?.(t.id);
            }}
          >
            <Icon />
          </button>
        );
      })}
    </div>
  );
}
