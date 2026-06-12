import { describe, expect, it } from "vitest";
import {
  removeMobileEnterAnalysisControl,
  shouldFallbackJoinToSpectating,
} from "../layouts/live-game-page";

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

describe("live game mobile controls", () => {
  const controls = {
    nav: {
      atStart: true,
      atLatest: true,
      atMainEnd: true,
      counter: "0",
      onNavigate: () => {},
    },
    analyze: {
      onClick: () => {},
    },
  };

  it("removes only the mobile enter-analysis control", () => {
    expect(
      removeMobileEnterAnalysisControl(controls, {
        isMobile: true,
        canEnterAnalysis: true,
      }).analyze,
    ).toBeUndefined();
  });

  it("keeps non-enter-analysis controls on mobile", () => {
    expect(
      removeMobileEnterAnalysisControl(controls, {
        isMobile: true,
        canEnterAnalysis: false,
      }).analyze,
    ).toBeDefined();
  });
});
