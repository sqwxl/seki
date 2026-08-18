import { signal } from "@preact/signals";
import type { AiAnalyzePositionResult } from "../ai-poc/types";
import type { PlayerPanelProps } from "../components/player-panel";
import { DEFAULT_NAV_STATE, type NavState } from "../game/state";
import type {
  Board,
  TerritoryInfo,
  TerritoryOverlay,
} from "../goban/create-board";
import type { GhostStoneData, HeatData, Point } from "../goban/types";
import type { SgfMeta } from "../utils/sgf";
import type { ParsedSgf } from "../utils/sgf-import";

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
export const analysisNavState = signal<NavState>(DEFAULT_NAV_STATE);
export const analysisTab = signal<"board" | "settings">("board");
export type AnalysisPanelData = PlayerPanelProps & {
  label: string;
  stone: "black" | "white";
};

export const analysisPanelState = signal<{
  top?: AnalysisPanelData;
  bottom?: AnalysisPanelData;
}>({});

// Set by the analysis page while mounted; the nav drawer hands off to it
// when import is triggered while the page is already open.
export const analysisSgfImport = signal<
  ((parsed: ParsedSgf) => void) | undefined
>(undefined);
export const analysisSgfExport = signal<(() => void) | undefined>(undefined);

// Set by the nav drawer when an SGF import is triggered off-page; the
// analysis page consumes it on mount. Deliberately not cleared by reset — it
// must survive until initAnalysis picks it up.
export const pendingAnalysisSgf = signal<ParsedSgf | undefined>(undefined);

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
  analysisNavState.value = DEFAULT_NAV_STATE;
  analysisTab.value = "board";
  analysisPanelState.value = {};
  analysisSgfImport.value = undefined;
  analysisSgfExport.value = undefined;
}
