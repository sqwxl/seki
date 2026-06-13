import { describe, expect, it } from "vitest";
import { getRouteDataUrl, parseRoute } from "../spa/routes";

describe("SPA routes", () => {
  it("parses the local bot practice route", () => {
    expect(parseRoute(new URL("https://seki.test/bot"))).toEqual({
      kind: "bot",
    });
  });

  it("does not fetch server route data for local bot practice", () => {
    expect(getRouteDataUrl({ kind: "bot" })).toBeUndefined();
  });
});
