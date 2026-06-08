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
    // Gridline Y axis expands beyond data range for at least 5 lines
    expect(graph!.minRating).toBeLessThanOrEqual(1500);
    expect(graph!.maxRating).toBeGreaterThanOrEqual(1520);
  });

  it("gridlines use round values and cover at least 5 lines", () => {
    const graph = buildRatingGraphData([
      historyEntry({ rating_before: 1500, rating_after: 1520 }),
      historyEntry({ game_id: 2, rating_before: 1520, rating_after: 1510 }),
    ]);

    expect(graph!.gridLines.length).toBeGreaterThanOrEqual(5);
    // Gridlines should be round (divisible by step)
    for (const gl of graph!.gridLines) {
      expect(gl.rating % 10).toBe(0);
    }
    // Y positions should descend as rating increases
    for (let i = 1; i < graph!.gridLines.length; i++) {
      expect(graph!.gridLines[i].rating).toBeGreaterThan(
        graph!.gridLines[i - 1].rating,
      );
      expect(graph!.gridLines[i].y).toBeLessThan(graph!.gridLines[i - 1].y);
    }
  });

  it("keeps flat rating history drawable", () => {
    const graph = buildRatingGraphData([
      historyEntry({ rating_before: 1500, rating_after: 1500 }),
    ]);

    expect(graph?.path).not.toContain("NaN");
    expect(graph?.path).not.toContain("Infinity");
    expect(graph!.gridLines.length).toBeGreaterThanOrEqual(5);
  });
});
