import type { ComponentChildren } from "preact";
import type { UserData } from "../game/types";
import { IconNigiri, IconUser, StoneBlack, StoneWhite } from "./icons";
import { UserRank, type UserRankProps } from "./user-rank";

export type UserLabelOptions = {
  stone?: "black" | "white" | "nigiri";
  link?: boolean;
  showPresence?: boolean;
  presence?: boolean;
  showRegistered?: boolean;
  compact?: boolean;
  strong?: boolean;
  rank?: UserRankProps;
};

type UserLabelProps = {
  user?: UserData | null;
  options?: UserLabelOptions;
  fallback?: ComponentChildren;
};

function StoneIcon({ stone }: { stone: "black" | "white" | "nigiri" }) {
  if (stone === "nigiri") {
    return <IconNigiri />;
  }

  return stone === "black" ? <StoneBlack /> : <StoneWhite />;
}

function labelClass(options: UserLabelOptions): string {
  return [
    "user-label",
    options.strong ? "active-turn" : "",
    options.compact ? "compact" : "",
  ]
    .filter(Boolean)
    .join(" ");
}

export function UserLabel({ user, options = {}, fallback }: UserLabelProps) {
  if (!user) {
    return <span class={labelClass(options)}>{fallback ?? "..."}</span>;
  }

  const rank = {
    value: user.rank,
    ...options.rank,
  };

  const el = (
    <span class={labelClass(options)}>
      {options.stone && (
        <span class="stone-icon">
          <StoneIcon stone={options.stone} />
        </span>
      )}
      {options.showRegistered && <IconUser />}
      <span class="player-name">{user.display_name}</span>{" "}
      <UserRank {...rank} />
      {options.showPresence && (
        <span class={`presence-dot${options.presence ? " online" : ""}`} />
      )}
    </span>
  );

  if (options.link) {
    return <a href={`/users/${user.display_name}`}>{el}</a>;
  }

  return el;
}
