import type { RankData } from "../game/types";
import type { RatingDisplayMode } from "../utils/rating";
import { alternateRankText, formatNumericRating, primaryRankText } from "../utils/rating";
import { readRatingDisplayPreference } from "../utils/preferences";

type UserRankProps = {
  rank?: RankData | null;
  displayMode?: RatingDisplayMode;
  showBoth?: boolean;
  bare?: boolean;
};

export function UserRank({ rank, displayMode, showBoth, bare }: UserRankProps) {
  const mode = displayMode ?? readRatingDisplayPreference();

  if (!rank || rank.status === "anonymous") {
    return bare ? null : <span class="player-rank">{""}</span>;
  }

  const primary = primaryRankText(rank, mode);
  const alternate = alternateRankText(rank, mode);
  const numeric = rank.rating != null ? formatNumericRating(rank.rating) : "";
  const kyuDan = rank.qualifier ?? "";

  if (showBoth && numeric && kyuDan) {
    const text = `${numeric} (${kyuDan})`;
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
