import { describe, expect, it } from "vitest";

import { buildRatingTrendPath } from "../components/rating-trend";
import { buildPlayersUrl } from "../spa/players-screen";
import { formatAgo } from "../utils/format";

describe("players screen helpers", () => {
  it("builds default players API URL", () => {
    expect(
      buildPlayersUrl({
        excludeUncertain: true,
        includeUnranked: false,
        onlineNow: false,
      }),
    ).toBe(
      "/api/web/players?offset=0&limit=50&exclude_uncertain=true&include_unranked=false&online_now=false",
    );
  });

  it("formats last active values as relative text", () => {
    const now = new Date("2026-05-31T12:00:00Z");

    expect(formatAgo("2026-05-31T11:59:35Z", now)).toBe("just now");
    expect(formatAgo("2026-05-31T11:45:00Z", now)).toBe("15m ago");
    expect(formatAgo("2026-05-31T09:00:00Z", now)).toBe("3h ago");
    expect(formatAgo("2026-05-29T12:00:00Z", now)).toBe("2d ago");
  });

  it("keeps flat trend data drawable", () => {
    const path = buildRatingTrendPath([1500, 1500, 1500]);

    expect(path).not.toContain("NaN");
    expect(path).not.toContain("Infinity");
  });
});
