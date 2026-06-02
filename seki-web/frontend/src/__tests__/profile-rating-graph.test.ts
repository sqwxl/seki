import { describe, expect, it } from "vitest";

import { buildRatingGraphData } from "../components/profile-rating-graph";
import type { RatingHistoryEntryData } from "../spa/types";

function historyEntry(
  overrides: Partial<RatingHistoryEntryData> = {},
): RatingHistoryEntryData {
  const entry: RatingHistoryEntryData = {
    game_id: 1,
    result: "win",
    rating_before: 1500,
    rating_after: 1520,
    deviation_before: 350,
    deviation_after: 330,
    volatility_before: 0.06,
    volatility_after: 0.06,
    rating_delta: 20,
    created_at: "2026-05-31T00:00:00Z",
    cols: 19,
    rows: 19,
    handicap: 0,
    komi: 6.5,
    time_control: "none",
    ...overrides,
  };

  return entry;
}

describe("buildRatingGraphData", () => {
  it("returns null when there is no visible rating history", () => {
    expect(buildRatingGraphData([])).toBeNull();
  });

  it("includes the starting rating before plotting rated results", () => {
    const graph = buildRatingGraphData([
      historyEntry({ rating_before: 1500, rating_after: 1520 }),
      historyEntry({ game_id: 2, rating_before: 1520, rating_after: 1510 }),
    ]);

    expect(graph?.points.map((point) => point.rating)).toEqual([
      1500, 1520, 1510,
    ]);
    expect(graph?.currentRating).toBe(1510);
    expect(graph?.minRating).toBe(1500);
    expect(graph?.maxRating).toBe(1520);
  });

  it("keeps flat rating history drawable", () => {
    const graph = buildRatingGraphData([
      historyEntry({ rating_before: 1500, rating_after: 1500 }),
    ]);

    expect(graph?.path).not.toContain("NaN");
    expect(graph?.path).not.toContain("Infinity");
  });
});
