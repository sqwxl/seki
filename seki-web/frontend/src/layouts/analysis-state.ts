import { signal } from "@preact/signals";
import type { Board, TerritoryInfo } from "../goban/create-board";
import type { Point } from "../goban/types";
import type { SgfMeta } from "../utils/sgf";

export const analysisBoard = signal<Board | undefined>(undefined);
export const analysisMeta = signal<SgfMeta | undefined>(undefined);
export const analysisSize = signal(19);
export const analysisKomi = signal(6.5);
export const analysisPendingMove = signal<Point | undefined>(undefined);
export const analysisTerritoryInfo = signal<TerritoryInfo>({
  reviewing: false,
  finalized: false,
  score: undefined,
});
export const analysisNavState = signal({
  atStart: true,
  atLatest: true,
  atMainEnd: true,
  counter: "0",
  boardTurnStone: 1,
  boardLastMoveWasPass: false,
});
export type AnalysisPanelData = {
  label: string;
  captures: number;
  komi?: number;
  territory?: number;
  stone: "black" | "white";
  clock?: string;
  clockLowTime?: boolean;
};

export const analysisPanelState = signal<{
  top?: AnalysisPanelData;
  bottom?: AnalysisPanelData;
}>({});

export function resetAnalysisRuntimeState(): void {
  analysisPendingMove.value = undefined;
  analysisTerritoryInfo.value = {
    reviewing: false,
    finalized: false,
    score: undefined,
  };
  analysisNavState.value = {
    atStart: true,
    atLatest: true,
    atMainEnd: true,
    counter: "0",
    boardTurnStone: 1,
    boardLastMoveWasPass: false,
  };
  analysisPanelState.value = {};
}
