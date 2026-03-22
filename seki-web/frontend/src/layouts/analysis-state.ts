import { signal } from "@preact/signals";
import type { Board, TerritoryInfo } from "../goban/create-board";
import type { Point } from "../goban/types";
import type { SgfMeta } from "../utils/sgf";

export const analysisBoard = signal<Board | undefined>(undefined);
export const analysisMeta = signal<SgfMeta | undefined>(undefined);
export const analysisSize = signal(19);
export const analysisKomi = signal(6.5);
export const analysisPendingMove = signal<Point | undefined>(undefined);
export const analysisRenderNonce = signal(0);
export const analysisTerritoryInfo = signal<TerritoryInfo>({
  reviewing: false,
  finalized: false,
  score: undefined,
});
export const analysisNavState = signal({
  boardTurnStone: 1,
  boardLastMoveWasPass: false,
});

export function resetAnalysisRuntimeState(): void {
  analysisPendingMove.value = undefined;
  analysisRenderNonce.value = 0;
  analysisTerritoryInfo.value = {
    reviewing: false,
    finalized: false,
    score: undefined,
  };
  analysisNavState.value = {
    boardTurnStone: 1,
    boardLastMoveWasPass: false,
  };
}
