import { mobileTab } from "../game/state";

type Tab = "board" | "chat" | "tree";

const tabs: { id: Tab; label: string }[] = [
  { id: "board", label: "Board" },
  { id: "chat", label: "Chat" },
  { id: "tree", label: "Tree" },
];

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
            onClick={() => {
              mobileTab.value = t.id;
            }}
          >
            {t.label}
          </button>
        ))}
    </div>
  );
}
