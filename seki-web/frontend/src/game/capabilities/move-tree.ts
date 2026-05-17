import { computed } from "@preact/signals";
import { gamePhase } from "../phase";
import { showMoveTree } from "../state";
import { isAnalysisCapablePhase } from "./build-overlay";
import type { LiveGameMoveTreeState } from "./types";

export const liveGameMoveTreeState = computed(
  (): LiveGameMoveTreeState => ({
    showMoveTree: showMoveTree.value || isAnalysisCapablePhase(gamePhase.value),
  }),
);
