import { beforeEach, describe, expect, it } from "vitest";
import {
  analysisMode,
  estimateMode,
  exitEstimate,
  exitPresentation,
  gameMode,
  resetMode,
  toAnalysis,
  toEstimate,
  toLive,
  toPresentation,
  toPresentationLocalAnalysis,
  toPresentationSyncedViewer,
} from "../game/mode";

beforeEach(() => {
  resetMode();
});

describe("GameMode transitions", () => {
  it("starts in live mode", () => {
    expect(gameMode.value).toEqual({ mode: "live" });
  });

  it("live -> analysis", () => {
    toAnalysis();
    expect(gameMode.value).toEqual({ mode: "analysis" });
    expect(analysisMode.value).toBe(true);
  });

  it("analysis -> live", () => {
    toAnalysis();
    toLive();
    expect(gameMode.value).toEqual({ mode: "live" });
    expect(analysisMode.value).toBe(false);
  });

  it("live -> estimate (fromAnalysis: false)", () => {
    toEstimate();
    expect(gameMode.value).toEqual({
      mode: "estimate",
      fromAnalysis: false,
    });
    expect(estimateMode.value).toBe(true);
  });

  it("analysis -> estimate (fromAnalysis: true)", () => {
    toAnalysis();
    toEstimate();
    expect(gameMode.value).toEqual({
      mode: "estimate",
      fromAnalysis: true,
    });
    expect(estimateMode.value).toBe(true);
  });

  it("estimate -> returns to analysis when fromAnalysis", () => {
    toAnalysis();
    toEstimate();
    exitEstimate();
    expect(gameMode.value).toEqual({ mode: "analysis" });
    expect(estimateMode.value).toBe(false);
    expect(analysisMode.value).toBe(true);
  });

  it("estimate -> returns to live when not fromAnalysis", () => {
    toEstimate();
    exitEstimate();
    expect(gameMode.value).toEqual({ mode: "live" });
    expect(estimateMode.value).toBe(false);
  });

  it("ignores invalid transitions: analysis from estimate", () => {
    toEstimate();
    toAnalysis(); // should be ignored
    expect(gameMode.value.mode).toBe("estimate");
  });

  it("ignores invalid transitions: estimate from presentation", () => {
    toPresentation("synced-viewer");
    toEstimate(); // should be ignored
    expect(gameMode.value.mode).toBe("presentation");
  });

  describe("presentation", () => {
    it("live -> presentation(synced-viewer)", () => {
      toPresentation("synced-viewer");
      expect(gameMode.value).toEqual({
        mode: "presentation",
        role: "synced-viewer",
      });
      expect(analysisMode.value).toBe(false);
    });

    it("live -> presentation(presenter)", () => {
      toPresentation("presenter");
      expect(gameMode.value).toEqual({
        mode: "presentation",
        role: "presenter",
      });
      expect(analysisMode.value).toBe(true);
    });

    it("synced-viewer -> local-analysis", () => {
      toPresentation("synced-viewer");
      toPresentationLocalAnalysis();
      expect(gameMode.value).toEqual({
        mode: "presentation",
        role: "local-analysis",
      });
      expect(analysisMode.value).toBe(true);
    });

    it("local-analysis -> synced-viewer", () => {
      toPresentation("synced-viewer");
      toPresentationLocalAnalysis();
      toPresentationSyncedViewer();
      expect(gameMode.value).toEqual({
        mode: "presentation",
        role: "synced-viewer",
      });
      expect(analysisMode.value).toBe(false);
    });

    it("exitPresentation resets to live", () => {
      toPresentation("presenter");
      exitPresentation();
      expect(gameMode.value).toEqual({ mode: "live" });
      expect(analysisMode.value).toBe(false);
    });

    it("ignores local-analysis from presenter", () => {
      toPresentation("presenter");
      toPresentationLocalAnalysis(); // should be ignored
      expect(gameMode.value).toEqual({
        mode: "presentation",
        role: "presenter",
      });
    });
  });
});
