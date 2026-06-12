import type { Signal } from "@preact/signals";
import type { analyzePositionDirect } from "../../ai/analyze";
import type {
  Board,
  TerritoryInfo,
  TerritoryOverlay,
} from "../../goban/create-board";
import type { GhostStoneData, HeatData, Point } from "../../goban/types";

export type AnalyzeResult = Awaited<ReturnType<typeof analyzePositionDirect>>;

export type AnalysisAiState = {
  enabled: boolean;
  pending: boolean;
  error?: string;
  result?: AnalyzeResult;
  nodeId?: number;
  heatMap?: (HeatData | null)[];
  ghostStoneMap?: (GhostStoneData | null)[];
};

export type AnalysisEstimateState = {
  pending: boolean;
  mode?: "estimate" | "review";
  nodeId?: number;
  result?: AnalyzeResult;
  ownership?: number[];
  overlay?: TerritoryOverlay;
};

export type AnalysisNavState = {
  atStart: boolean;
  atLatest: boolean;
  atMainEnd: boolean;
  counter: string;
  boardTurnStone: number;
  boardLastMoveWasPass: boolean;
};

export type AnalysisSessionSignals = {
  board: Signal<Board | undefined>;
  pendingMove: Signal<Point | undefined>;
  ai: Signal<AnalysisAiState>;
  estimate: Signal<AnalysisEstimateState>;
  territoryInfo: Signal<TerritoryInfo>;
  nav: Signal<AnalysisNavState>;
};

export type CachedAiEval = {
  result: AnalyzeResult;
  ownership?: number[];
  overlay?: TerritoryOverlay;
};
