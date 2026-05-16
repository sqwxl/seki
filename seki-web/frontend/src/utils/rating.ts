export type RatingDisplayMode = "kyu_dan" | "rating";

export type RankStatus = "anonymous" | "not_participating" | "unranked" | "ranked";

export type RankData = {
  qualifier?: string | null;
  status: RankStatus;
  rating?: number | null;
  deviation?: number | null;
  volatility?: number | null;
  uncertain: boolean;
};

export function parseRatingDisplayMode(value: unknown): RatingDisplayMode {
  return value === "rating" ? "rating" : "kyu_dan";
}

export function formatNumericRating(rating: number): string {
  return Math.round(rating).toString();
}

export function primaryRankText(
  rank: RankData | undefined | null,
  mode: RatingDisplayMode = "kyu_dan",
): string {
  if (!rank || rank.status === "anonymous") {
    return "";
  }
  if (rank.status === "not_participating") {
    return "(-)";
  }
  if (rank.status === "unranked") {
    return "(?)";
  }

  const value =
    mode === "rating"
      ? rank.rating == null
        ? null
        : formatNumericRating(rank.rating)
      : rank.qualifier;
  if (!value) {
    return "";
  }

  return `(${value}${rank.uncertain ? "?" : ""})`;
}

export function alternateRankText(
  rank: RankData | undefined | null,
  mode: RatingDisplayMode = "kyu_dan",
): string {
  if (!rank || rank.status !== "ranked") {
    return "";
  }

  const value =
    mode === "rating"
      ? rank.qualifier
      : rank.rating == null
        ? null
        : formatNumericRating(rank.rating);
  if (!value) {
    return "";
  }

  return `${value}${rank.uncertain ? "?" : ""}`;
}
