import type { RankData } from "../../../game/types";

export function rankedSettingsFromGap(
  blackRating: number,
  whiteRating: number,
): { handicap: number; komi: number; color: string } {
  const rps = 100;
  const gap = Math.abs(blackRating - whiteRating);
  const steps = Math.floor(gap / rps);
  const handicap = steps >= 2 ? Math.min(steps, 9) : 0;
  const komi = handicap >= 2 ? 0.5 : 6.5;

  if (Math.abs(blackRating - whiteRating) < 0.01) {
    return { handicap, komi, color: "nigiri" };
  }

  return {
    handicap,
    komi,
    color: blackRating < whiteRating ? "black" : "white",
  };
}

export function inferSettingsFromRanks(
  currentUserRank: RankData | undefined | null,
  opponentRank: RankData | undefined | null,
): { handicap: number; komi: number; color: string } | null {
  if (currentUserRank?.rating == null || opponentRank?.rating == null) {
    return null;
  }

  return rankedSettingsFromGap(currentUserRank.rating, opponentRank.rating);
}
