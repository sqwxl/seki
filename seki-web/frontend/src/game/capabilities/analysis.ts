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
  const { reviewing, confirming, finalized, score } =
    analysisTerritoryInfo.value;
  const nav = analysisNavState.value;
  const canPlay = !reviewing;

  const isBlackTurn = nav.boardTurnStone === 1;
  const statusText =
    getStatusText({
      stage: reviewing
        ? confirming
          ? GameStage.TerritoryReview
          : isBlackTurn
            ? GameStage.BlackToPlay
            : GameStage.WhiteToPlay
        : isBlackTurn
          ? GameStage.BlackToPlay
          : GameStage.WhiteToPlay,
      komi: analysisKomi.value,
      estimateScore: finalized ? score : undefined,
      territoryScore: confirming ? score : undefined,
      lastMoveWasPass: nav.boardLastMoveWasPass,
      isBlackTurn,
    }) ?? "";

  return {
    canPass: canPlay,
    canEstimate: canPlay && !finalized,
    showEstimate: !confirming,
    canPlayMove: canPlay,
    showTerritoryReady: confirming,
    showTerritoryExit: confirming,
    showSgfImport: canPlay,
    showSgfExport: canPlay,
    statusText,
  };
});
