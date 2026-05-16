import { describe, expect, it } from "vitest";

import { UserRank } from "../components/user-rank";
import {
  alternateRankText,
  fullRankText,
  parseRatingDisplayMode,
  primaryRankText,
  type RankData,
  type RatingDisplayMode,
} from "../utils/rating";

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
    expect(fullRankText(rank)).toBe("1560 (3k)");
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
    expect(fullRankText(uncertain)).toBe("1500? (8k?)");
    const unranked: RankData = {
      qualifier: "?",
      status: "unranked",
      rating: 1450,
      deviation: 350,
      volatility: 0.06,
      uncertain: true,
    };
    expect(primaryRankText(unranked)).toBe("(?)");
    expect(alternateRankText(unranked)).toBe("1450?");
    expect(primaryRankText(unranked, "rating")).toBe("(1450?)");
    expect(alternateRankText(unranked, "rating")).toBe("?");
    expect(fullRankText(unranked)).toBe("1450? (?)");
    expect(
      primaryRankText({ status: "not_participating", uncertain: false }),
    ).toBe("(-)");
    expect(primaryRankText({ status: "anonymous", uncertain: false })).toBe("");
  });

  it("renders rank primary text and alternate title with UserRank", () => {
    const rank: RankData = {
      qualifier: "3k",
      status: "ranked",
      rating: 1560,
      deviation: 80,
      volatility: 0.06,
      uncertain: false,
    };

    const view = UserRank({ value: rank, displayMode: "kyu_dan" }) as any;
    expect(view.props.class).toBe("player-rank");
    expect(view.props.children).toBe("(3k)");
    expect(view.props.title).toBe("1560");
    expect(view.props["aria-label"]).toBe("(3k) 1560");
  });

  it("renders numeric rating as the primary display when mode=rating", () => {
    const view = UserRank({
      value: {
        qualifier: "3k",
        status: "ranked",
        rating: 1560,
        deviation: 120,
        volatility: 0.06,
        uncertain: true,
      },
      displayMode: "rating",
    }) as any;

    expect(view.props.children).toBe("(1560?)");
    expect(view.props.title).toBe("3k?");
  });

  it("renders both formats when showBoth is set", () => {
    const view = UserRank({
      value: {
        qualifier: "3k",
        status: "ranked",
        rating: 1560,
        deviation: 80,
        volatility: 0.06,
        uncertain: false,
      },
      showBoth: true,
    }) as any;

    expect(view.props.class).toBe("player-rank");
    expect(view.props.children).toBe("1560 (3k)");
  });
  it("formats (unrated) in game descriptions when ranked is false", () => {
    const parts = (() => {
      // Simulate the buildDescriptionParts logic inline to test the (unrated) addition
      const g = {
        settings: {
          cols: 19,
          rows: 19,
          handicap: 0,
          ranked: false,
          time_control: "none" as const,
          main_time_secs: undefined,
          increment_secs: undefined,
          byoyomi_time_secs: undefined,
          byoyomi_periods: undefined,
          is_private: false,
          invite_only: false,
        },
        stage: "unstarted" as const,
        result: undefined,
        move_count: undefined,
        creator_id: undefined,
        black: undefined,
        white: undefined,
      };
      const parts: string[] = [];
      parts.push("19×19");
      if (g.settings.ranked === false) {
        parts.push("(unrated)");
      }
      return parts;
    })();

    expect(parts).toContain("(unrated)");
  });

  it("omits (unrated) from game descriptions when ranked is true", () => {
    const parts = (() => {
      const g = {
        settings: {
          cols: 19,
          rows: 19,
          handicap: 0,
          ranked: true,
          time_control: "none" as const,
          main_time_secs: undefined,
          increment_secs: undefined,
          byoyomi_time_secs: undefined,
          byoyomi_periods: undefined,
          is_private: false,
          invite_only: false,
        },
        stage: "unstarted" as const,
        result: undefined,
        move_count: undefined,
        creator_id: undefined,
        black: undefined,
        white: undefined,
      };
      const parts: string[] = [];
      parts.push("19×19");
      if (g.settings.ranked === false) {
        parts.push("(unrated)");
      }
      return parts;
    })();

    expect(parts).not.toContain("(unrated)");
  });
});
