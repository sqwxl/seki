import { mobileTab, hasUnreadChat } from "../game/state";
import { IconChat, IconChatUnread, IconStonesBw } from "./icons";

type Tab = "board" | "chat" | "tree";

const tabs: { id: Tab; label: string }[] = [
  { id: "board", label: "Board" },
  { id: "chat", label: "Chat" },
  { id: "tree", label: "Tree" },
];

function TabIcon({ id }: { id: Tab }) {
  if (id === "board") {
    return <IconStonesBw />;
  }
  if (id === "chat") {
    return hasUnreadChat.value ? <IconChatUnread /> : <IconChat />;
  }
  return null;
}

export type TabBarProps = {
  /** Hide specific tabs (e.g. analysis page has no chat) */
  hideTabs?: Tab[];
};

export function TabBar({ hideTabs }: TabBarProps) {
  const current = mobileTab.value;
  return (
    <div class="mobile-tab-bar">
      {tabs
        .filter((t) => !hideTabs?.includes(t.id))
        .map((t) => (
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
            {t.id === "tree" && t.label}
          </button>
        ))}
    </div>
  );
}
