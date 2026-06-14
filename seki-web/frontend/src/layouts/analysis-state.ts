import { signal } from "@preact/signals";
import type { AiAnalyzePositionResult } from "../ai-poc/types";
import type { PlayerPanelProps } from "../components/player-panel";
import type {
  Board,
  TerritoryInfo,
  TerritoryOverlay,
} from "../goban/create-board";
import type { GhostStoneData, HeatData, Point } from "../goban/types";
import type { SgfMeta } from "../utils/sgf";

export const analysisBoard = signal<Board | undefined>(undefined);
export const analysisMeta = signal<SgfMeta | undefined>(undefined);
export const analysisSize = signal(19);
export const analysisKomi = signal(6.5);
export const analysisPendingMove = signal<Point | undefined>(undefined);
export const analysisAiState = signal<{
  enabled: boolean;
  pending: boolean;
  error?: string;
  result?: AiAnalyzePositionResult;
  nodeId?: number;
  heatMap?: (HeatData | null)[];
  ghostStoneMap?: (GhostStoneData | null)[];
}>({
  enabled: false,
  pending: false,
});
export const analysisAiTerritoryState = signal<{
  pending: boolean;
  mode?: "estimate" | "review";
  nodeId?: number;
  result?: AiAnalyzePositionResult;
  ownership?: number[];
  overlay?: TerritoryOverlay;
}>({
  pending: false,
});
export const analysisTerritoryInfo = signal<TerritoryInfo>({
  estimating: false,
  reviewing: false,
  confirming: false,
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
export type AnalysisPanelData = PlayerPanelProps & {
  label: string;
  stone: "black" | "white";
};

export const analysisPanelState = signal<{
  top?: AnalysisPanelData;
  bottom?: AnalysisPanelData;
}>({});

export function resetAnalysisRuntimeState(): void {
  analysisPendingMove.value = undefined;
  analysisAiState.value = { enabled: false, pending: false };
  analysisAiTerritoryState.value = { pending: false };
  analysisTerritoryInfo.value = {
    estimating: false,
    reviewing: false,
    confirming: false,
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
