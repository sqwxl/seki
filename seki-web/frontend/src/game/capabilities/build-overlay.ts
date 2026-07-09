import type { TerritoryOverlay } from "../../goban/create-board";
import type { Point } from "../../goban/types";
import type { GameMode } from "../mode";
import type { SettledTerritoryData, TerritoryData } from "../types";
import { GameStage } from "../types";

export function buildTerritoryOverlay(data: {
  ownership: number[];
  dead_stones: [number, number][];
}): TerritoryOverlay {
  const paintMap = data.ownership.map((v) => (v === 0 ? null : v));
  const dimmedVertices: Point[] = data.dead_stones.map(
    ([c, r]) => [c, r] as Point,
  );
  return { paintMap, dimmedVertices };
}

export function deriveTerritoryOverlay(
  mode: GameMode,
  stage: GameStage,
  terr: TerritoryData | undefined,
  settled: SettledTerritoryData | undefined,
): TerritoryOverlay | undefined {
  if (stage === GameStage.TerritoryReview && terr) {
    return buildTerritoryOverlay(terr);
  }

  // Settled territory overlay for estimate mode on finished games (not in analysis — WASM handles that)
  if (mode.mode === "estimate" && !mode.fromAnalysis && settled) {
    return buildTerritoryOverlay(settled);
  }

  return;
}

export function isAnalysisCapablePhase(mode: GameMode): boolean {
  return (
    mode.mode === "analysis" ||
    (mode.mode === "presentation" &&
      (mode.role === "presenter" || mode.role === "local-analysis"))
  );
}
