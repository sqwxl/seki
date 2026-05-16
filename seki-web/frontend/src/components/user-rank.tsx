import type { RankData } from "../game/types";
import type { RatingDisplayMode } from "../utils/rating";
import {
  alternateRankText,
  fullRankText,
  primaryRankText,
} from "../utils/rating";
import { ratingDisplayPreference } from "../utils/preferences";

export type UserRankProps = {
  value?: RankData | null;
  displayMode?: RatingDisplayMode;
  showBoth?: boolean;
  bare?: boolean;
};

export function UserRank({
  value: rank,
  displayMode,
  showBoth,
  bare,
}: UserRankProps) {
  const mode = displayMode ?? ratingDisplayPreference.value;

  if (!rank || rank.status === "anonymous") {
    return bare ? null : <span class="player-rank">{""}</span>;
  }

  const primary = primaryRankText(rank, mode);
  const alternate = alternateRankText(rank, mode);

  if (showBoth) {
    const text = fullRankText(rank);
    if (!text) {
      return bare ? null : <span class="player-rank">{""}</span>;
    }
    if (bare) {
      return <>{text}</>;
    }
    return (
      <span class="player-rank" title={alternate || undefined}>
        {text}
      </span>
    );
  }

  if (!primary) {
    return bare ? null : <span class="player-rank">{""}</span>;
  }

  if (bare) {
    return <>{primary}</>;
  }

  return (
    <span
      class="player-rank"
      title={alternate || undefined}
      aria-label={alternate ? `${primary} ${alternate}` : primary}
    >
      {primary}
    </span>
  );
}
