import { computed } from "@preact/signals";
import { getStatusText } from "../../components/game-status";
import {
  analysisKomi,
  analysisNavState,
  analysisTerritoryInfo,
} from "../../layouts/analysis-state";
import { GameStage } from "../types";
import type { AnalysisCapabilities } from "./types";

export const analysisCapabilities = computed((): AnalysisCapabilities => {
  const { reviewing, finalized, score } = analysisTerritoryInfo.value;
  const nav = analysisNavState.value;
  const canPlay = !reviewing;

  const isBlackTurn = nav.boardTurnStone === 1;
  const statusText =
    getStatusText({
      stage: reviewing
        ? GameStage.TerritoryReview
        : isBlackTurn
          ? GameStage.BlackToPlay
          : GameStage.WhiteToPlay,
      komi: analysisKomi.value,
      estimateScore: finalized ? score : undefined,
      territoryScore: reviewing ? score : undefined,
      lastMoveWasPass: nav.boardLastMoveWasPass,
      isBlackTurn,
    }) ?? "";

  return {
    canPass: canPlay,
    canEstimate: canPlay && !finalized,
    showEstimate: canPlay,
    canPlayMove: canPlay,
    showTerritoryReady: reviewing,
    showTerritoryExit: reviewing,
    showSgfImport: canPlay,
    showSgfExport: canPlay,
    statusText,
  };
});
