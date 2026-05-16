import { describe, expect, it } from "vitest";

import {
  alternateRankText,
  parseRatingDisplayMode,
  primaryRankText,
  type RankData,
  type RatingDisplayMode,
} from "../utils/rating";
import { UserLabel } from "../components/user-label";

describe("rating formatting", () => {
  it("accepts the default display mode", () => {
    const mode: RatingDisplayMode = "kyu_dan";

    expect(mode).toBe("kyu_dan");
  });

  it("falls back to kyu dan for missing or invalid preference values", () => {
    expect(parseRatingDisplayMode(undefined)).toBe("kyu_dan");
    expect(parseRatingDisplayMode("invalid")).toBe("kyu_dan");
    expect(parseRatingDisplayMode("rating")).toBe("rating");
  });

  it("formats ranked labels with primary and alternate values", () => {
    const rank: RankData = {
      qualifier: "3k",
      status: "ranked",
      rating: 1560.4,
      deviation: 80,
      volatility: 0.06,
      uncertain: false,
    };

    expect(primaryRankText(rank, "kyu_dan")).toBe("(3k)");
    expect(alternateRankText(rank, "kyu_dan")).toBe("1560");
    expect(primaryRankText(rank, "rating")).toBe("(1560)");
    expect(alternateRankText(rank, "rating")).toBe("3k");
  });

  it("formats uncertain and non-participating states", () => {
    const uncertain: RankData = {
      qualifier: "8k",
      status: "ranked",
      rating: 1500,
      deviation: 120,
      volatility: 0.06,
      uncertain: true,
    };

    expect(primaryRankText(uncertain)).toBe("(8k?)");
    expect(alternateRankText(uncertain)).toBe("1500?");
    expect(primaryRankText({ status: "unranked", uncertain: true })).toBe("(?)");
    expect(primaryRankText({ status: "not_participating", uncertain: false })).toBe("(-)");
    expect(primaryRankText({ status: "anonymous", uncertain: false })).toBe("");
  });

  it("renders user-label rank primary text and alternate title", () => {
    const rank: RankData = {
      qualifier: "3k",
      status: "ranked",
      rating: 1560,
      deviation: 80,
      volatility: 0.06,
      uncertain: false,
    };

    const view = UserLabel({
      name: "honinbo",
      rank,
      ratingDisplay: "kyu_dan",
    }) as any;
    const rankNode = view.props.children.find(
      (child: any) => child?.props?.class === "player-rank",
    );

    expect(rankNode.props.children).toBe("(3k)");
    expect(rankNode.props.title).toBe("1560");
    expect(rankNode.props["aria-label"]).toBe("(3k) 1560");
  });

  it("renders numeric rating as the user-label primary display when selected", () => {
    const view = UserLabel({
      name: "honinbo",
      rank: {
        qualifier: "3k",
        status: "ranked",
        rating: 1560,
        deviation: 120,
        volatility: 0.06,
        uncertain: true,
      },
      ratingDisplay: "rating",
    }) as any;
    const rankNode = view.props.children.find(
      (child: any) => child?.props?.class === "player-rank",
    );

    expect(rankNode.props.children).toBe("(1560?)");
    expect(rankNode.props.title).toBe("3k?");
  });
});
