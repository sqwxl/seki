import { computed } from "@preact/signals";
import { gameMode } from "../mode";
import {
  currentTurn,
  gameStage,
  gameState,
  hasUnreadChat,
  moveConfirmEnabled,
  playerStone,
  settledTerritory,
  territory,
} from "../state";
import { GameStage, isPlayStage } from "../types";
import {
  deriveTerritoryOverlay,
  isAnalysisCapablePhase,
} from "./build-overlay";
import { liveGameControlsState } from "./controls";
import { liveGamePanelState } from "./panels";
import { liveGameStatusState } from "./status";
import type { UiCapabilities } from "./types";

/**
 * Backward-compatible aggregate for tests and callers that still want the full
 * live-game capability shape. Keep new behavior in the focused selectors above.
 */
export const liveGameCapabilities = computed((): UiCapabilities => {
  const mode = gameMode.value;
  const stage = gameStage.value;
  const stone = playerStone.value;
  const isPlayer = stone !== 0;
  const isChallenge = stage === GameStage.Challenge;
  const isPlay = isPlayStage(stage);
  const isReview = stage === GameStage.TerritoryReview;
  const isDone =
    stage === GameStage.Completed ||
    stage === GameStage.Aborted ||
    stage === GameStage.Declined;
  const terr = territory.value;
  const settled = settledTerritory.value;
  const inAnalysis = isAnalysisCapablePhase(mode);
  const inEstimate = mode.mode === "estimate";
  const isSyncedViewer =
    mode.mode === "presentation" && mode.role === "synced-viewer";
  const isMyTurn = isPlayer && currentTurn.value === stone && isPlay;

  return {
    ...liveGameControlsState.value,
    canToggleDeadStones: isReview && isPlayer,

    ...liveGameStatusState.value,

    canNavigate: !isSyncedViewer,

    ...liveGamePanelState.value,

    canPlayMove:
      inAnalysis || (isPlayer && !isDone && !isChallenge && isMyTurn),
    showGhostStone: !inAnalysis && !inEstimate && moveConfirmEnabled.value,
    territoryOverlay: deriveTerritoryOverlay(mode, stage, terr, settled),
    boardAspectRatio: `${gameState.value.cols}/${gameState.value.rows}`,

    showChat: true,
    hasUnreadChat: hasUnreadChat.value,
  };
});
