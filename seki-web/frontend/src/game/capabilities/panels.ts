import { computed } from "@preact/signals";
import { clockDisplay } from "../clock";
import {
  black,
  boardFinalized,
  boardFinalizedScore,
  currentTurn,
  estimateScore,
  gameStage,
  gameState,
  initialProps,
  nigiri,
  onlineUsers,
  playerStone,
  result,
  settledTerritory,
  territory,
  white,
} from "../state";
import { GameStage, isPlayStage } from "../types";
import { derivePlayerPanel } from "./build-panels";
import type { LiveGamePanelState } from "./types";

export const liveGamePanelState = computed((): LiveGamePanelState => {
  const stone = playerStone.value;
  const stage = gameStage.value;
  const res = result.value;
  const props = initialProps.value;
  const b = black.value;
  const w = white.value;
  const online = onlineUsers.value;
  const cd = clockDisplay.value;
  const turn = currentTurn.value;
  const terr = territory.value;
  const settled = settledTerritory.value;
  const isPlay = isPlayStage(stage);
  const isReview = stage === GameStage.TerritoryReview;
  const isNigiriPending = nigiri.value && !isPlay && !isReview && !res;
  const onFinalized = boardFinalized.value;
  const score =
    estimateScore.value ??
    terr?.score ??
    (onFinalized ? (boardFinalizedScore.value ?? settled?.score) : undefined);
  const panelOpts = {
    stone,
    blackUser: b,
    whiteUser: w,
    online,
    komi: props.komi,
    captures: gameState.value.captures,
    score,
    cd,
    isNigiriPending,
    currentTurn: turn,
  };

  return {
    topPanel: derivePlayerPanel({ ...panelOpts, position: "top" }),
    bottomPanel: derivePlayerPanel({ ...panelOpts, position: "bottom" }),
  };
});
