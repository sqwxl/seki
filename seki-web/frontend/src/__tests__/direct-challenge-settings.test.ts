import { describe, expect, it } from "vitest";

import type { RankData } from "../game/types";
import {
  inferSettingsFromRanks,
  rankedSettingsFromGap,
} from "../layouts/form-variants/direct-challenge";

function rank(rating: number): RankData {
  return {
    qualifier: "1k",
    status: "ranked",
    rating,
    deviation: 80,
    volatility: 0.06,
    uncertain: false,
  };
}

describe("direct challenge inferred settings", () => {
  it("infers handicap, komi, and color from rating gap", () => {
    expect(rankedSettingsFromGap(1200, 1550)).toEqual({
      handicap: 3,
      komi: 0.5,
      color: "black",
    });
    expect(rankedSettingsFromGap(1550, 1200)).toEqual({
      handicap: 3,
      komi: 0.5,
      color: "white",
    });
  });

  it("infers even games and handles missing ratings", () => {
    expect(inferSettingsFromRanks(rank(1500), rank(1500))).toEqual({
      handicap: 0,
      komi: 6.5,
      color: "nigiri",
    });
    expect(inferSettingsFromRanks(rank(1500), null)).toBeNull();
  });
});
