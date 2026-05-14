import { describe, expect, it } from "vitest";
import { shouldFallbackJoinToSpectating } from "../layouts/live-game-page";

describe("live game page join fallback", () => {
  it("falls back to spectating when join fails because the game is full", () => {
    expect(
      shouldFallbackJoinToSpectating({
        status: 422,
        message: "Game is full",
      }),
    ).toBe(true);
  });

  it("does not fall back for unrelated join failures", () => {
    expect(
      shouldFallbackJoinToSpectating({
        status: 422,
        message: "This game requires a valid access token to join",
      }),
    ).toBe(false);
  });
});
