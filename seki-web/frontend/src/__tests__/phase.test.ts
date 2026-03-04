import { describe, it, expect, beforeEach } from "vitest";
import {
  gamePhase,
  analysisMode,
  estimateMode,
  toAnalysis,
  toLive,
  toEstimate,
  exitEstimate,
  toPresentation,
  toPresentationLocalAnalysis,
  toPresentationSyncedViewer,
  exitPresentation,
  resetPhase,
} from "../game/phase";

beforeEach(() => {
  resetPhase();
});

describe("GamePhase transitions", () => {
  it("starts in live phase", () => {
    expect(gamePhase.value).toEqual({ phase: "live" });
  });

  it("live -> analysis", () => {
    toAnalysis();
    expect(gamePhase.value).toEqual({ phase: "analysis" });
    expect(analysisMode.value).toBe(true);
  });

  it("analysis -> live", () => {
    toAnalysis();
    toLive();
    expect(gamePhase.value).toEqual({ phase: "live" });
    expect(analysisMode.value).toBe(false);
  });

  it("live -> estimate (fromAnalysis: false)", () => {
    toEstimate();
    expect(gamePhase.value).toEqual({
      phase: "estimate",
      fromAnalysis: false,
    });
    expect(estimateMode.value).toBe(true);
  });

  it("analysis -> estimate (fromAnalysis: true)", () => {
    toAnalysis();
    toEstimate();
    expect(gamePhase.value).toEqual({
      phase: "estimate",
      fromAnalysis: true,
    });
    expect(estimateMode.value).toBe(true);
  });

  it("estimate -> returns to analysis when fromAnalysis", () => {
    toAnalysis();
    toEstimate();
    exitEstimate();
    expect(gamePhase.value).toEqual({ phase: "analysis" });
    expect(estimateMode.value).toBe(false);
    expect(analysisMode.value).toBe(true);
  });

  it("estimate -> returns to live when not fromAnalysis", () => {
    toEstimate();
    exitEstimate();
    expect(gamePhase.value).toEqual({ phase: "live" });
    expect(estimateMode.value).toBe(false);
  });

  it("ignores invalid transitions: analysis from estimate", () => {
    toEstimate();
    toAnalysis(); // should be ignored
    expect(gamePhase.value.phase).toBe("estimate");
  });

  it("ignores invalid transitions: estimate from presentation", () => {
    toPresentation("synced-viewer");
    toEstimate(); // should be ignored
    expect(gamePhase.value.phase).toBe("presentation");
  });

  describe("presentation", () => {
    it("live -> presentation(synced-viewer)", () => {
      toPresentation("synced-viewer");
      expect(gamePhase.value).toEqual({
        phase: "presentation",
        role: "synced-viewer",
      });
      expect(analysisMode.value).toBe(false);
    });

    it("live -> presentation(presenter)", () => {
      toPresentation("presenter");
      expect(gamePhase.value).toEqual({
        phase: "presentation",
        role: "presenter",
      });
      expect(analysisMode.value).toBe(true);
    });

    it("synced-viewer -> local-analysis", () => {
      toPresentation("synced-viewer");
      toPresentationLocalAnalysis();
      expect(gamePhase.value).toEqual({
        phase: "presentation",
        role: "local-analysis",
      });
      expect(analysisMode.value).toBe(true);
    });

    it("local-analysis -> synced-viewer", () => {
      toPresentation("synced-viewer");
      toPresentationLocalAnalysis();
      toPresentationSyncedViewer();
      expect(gamePhase.value).toEqual({
        phase: "presentation",
        role: "synced-viewer",
      });
      expect(analysisMode.value).toBe(false);
    });

    it("exitPresentation resets to live", () => {
      toPresentation("presenter");
      exitPresentation();
      expect(gamePhase.value).toEqual({ phase: "live" });
      expect(analysisMode.value).toBe(false);
    });

    it("ignores local-analysis from presenter", () => {
      toPresentation("presenter");
      toPresentationLocalAnalysis(); // should be ignored
      expect(gamePhase.value).toEqual({
        phase: "presentation",
        role: "presenter",
      });
    });
  });
});
