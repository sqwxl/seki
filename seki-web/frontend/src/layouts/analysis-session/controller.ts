import { KATA9X9_MANIFEST, analyzePositionDirect } from "../../ai/analyze";
import {
  ghostStoneMapFromRootMoves,
  heatMapFromRootMoves,
} from "../../ai/heatmap";
import { ensureAiModelAvailable } from "../../ai/model-download";
import {
  aiEstimatePositionFromEngine,
  aiPositionFromEngine,
} from "../../ai/position";
import { GameStage } from "../../game/types";
import type { Board, TerritoryInfo } from "../../goban/create-board";
import type { Sign } from "../../goban/types";
import {
  handleMoveConfirmClick,
  type MoveConfirmState,
} from "../../utils/move-confirm";
import {
  buildAiOwnershipOverlay,
  estimateCacheKey,
  normalizedOwnershipForBoard,
} from "./overlays";
import type {
  AnalysisSessionSignals,
  AnalyzeResult,
  CachedAiEval,
} from "./types";

export type {
  AnalysisAiState,
  AnalysisEstimateState,
  AnalysisNavState,
  AnalysisSessionSignals,
} from "./types";

type AnalysisSessionOptions = {
  state: AnalysisSessionSignals;
  moveConfirm: MoveConfirmState;
  getKomi: () => number;
  canUseAi?: () => boolean;
  ensureAiModel?: () => Promise<boolean>;
  onRender?: (board: Board, territoryInfo: TerritoryInfo) => void;
  onPlaySound?: () => void;
  onPassSound?: () => void;
  onClearVariations?: () => void;
};

export type AnalysisSessionController = ReturnType<
  typeof createAnalysisSessionController
>;

export function createAnalysisSessionController(
  options: AnalysisSessionOptions,
) {
  const { state, moveConfirm } = options;
  const aiEvalCache = new Map<number, CachedAiEval>();
  const aiEstimateCache = new Map<string, CachedAiEval>();
  let aiRequestId = 0;
  let aiTerritoryRequestId = 0;
  let lastRenderedNodeId: number | undefined;

  function board() {
    return state.board.value;
  }

  function aiAllowed(current = board()) {
    return (
      !!current &&
      current.engine.cols() === 9 &&
      current.engine.rows() === 9 &&
      (options.canUseAi?.() ?? true)
    );
  }

  function canRunAiSuggestion(current = board()) {
    return (
      aiAllowed(current) &&
      !state.territoryInfo.value.confirming &&
      current?.engine.stage() !== GameStage.TerritoryReview
    );
  }

  function hasFreshAiSuggestion(current = board()) {
    const ai = state.ai.value;

    return (
      !!current &&
      !ai.pending &&
      (ai.result || ai.error) &&
      ai.nodeId === current.engine.current_node_id()
    );
  }

  function estimateModeActive() {
    return (
      (state.territoryInfo.value.estimating &&
        !state.territoryInfo.value.confirming) ||
      state.estimate.value.mode === "estimate"
    );
  }

  function renderAiOverlay(current: Board) {
    if (typeof current.renderBoardOnly === "function") {
      current.renderBoardOnly();
    } else {
      current.render();
    }
  }

  function syncPendingMove() {
    state.pendingMove.value = moveConfirm.value;
  }

  function clearPendingMove() {
    moveConfirm.clear();
    state.pendingMove.value = undefined;
  }

  function getGhostStone() {
    return moveConfirm.getGhostStone();
  }

  function aiHeatOverlay() {
    const current = board();
    const ai = state.ai.value;

    if (!current || ai.nodeId !== current.engine.current_node_id()) {
      return undefined;
    }

    return ai.heatMap;
  }

  function aiGhostStoneOverlay() {
    const current = board();
    const ai = state.ai.value;

    if (!current || ai.nodeId !== current.engine.current_node_id()) {
      return undefined;
    }

    return ai.ghostStoneMap;
  }

  function aiTerritoryOwnership() {
    const current = board();
    const estimate = state.estimate.value;

    if (!current) {
      return undefined;
    }

    return normalizedOwnershipForBoard(
      current,
      estimate.nodeId,
      estimate.ownership,
    );
  }

  function clearAiSuggestion(renderBoard = true) {
    const ai = state.ai.value;

    if (ai.pending || ai.result || ai.error || ai.heatMap || ai.ghostStoneMap) {
      aiRequestId += 1;
      state.ai.value = {
        enabled: state.ai.value.enabled,
        pending: false,
      };

      const current = board();

      if (renderBoard && current) {
        renderAiOverlay(current);
      }
    }
  }

  function clearEstimate() {
    aiTerritoryRequestId += 1;
    state.estimate.value = { pending: false };
  }

  function clearAiCaches() {
    aiEvalCache.clear();
    aiEstimateCache.clear();
    clearAiSuggestion(false);
    clearEstimate();
  }

  function ensureModel() {
    return (
      options.ensureAiModel?.() ??
      ensureAiModelAvailable({
        manifestUrl: KATA9X9_MANIFEST,
        context: "analysis",
      })
    );
  }

  function refreshAiSuggestion() {
    const current = board();

    if (
      state.ai.value.enabled &&
      canRunAiSuggestion(current) &&
      !hasFreshAiSuggestion(current)
    ) {
      void aiSuggest();
    }
  }

  function applyAiSuggestion(
    result: AnalyzeResult,
    nodeId: number,
    boardSize: number,
    sign: Sign,
  ) {
    state.ai.value = {
      enabled: true,
      pending: false,
      result,
      nodeId,
      heatMap: heatMapFromRootMoves(result.analysis.rootMoves, boardSize),
      ghostStoneMap: ghostStoneMapFromRootMoves(
        result.analysis.rootMoves,
        boardSize,
        sign,
      ),
    };
  }

  async function aiSuggest() {
    const current = board();

    if (
      !current ||
      !state.ai.value.enabled ||
      state.ai.value.pending ||
      !canRunAiSuggestion(current)
    ) {
      return;
    }

    const requestId = ++aiRequestId;
    const nodeId = current.engine.current_node_id();
    const sign = current.engine.current_turn_stone() as Sign;
    const cachedEval = aiEvalCache.get(nodeId);

    if (cachedEval) {
      applyAiSuggestion(cachedEval.result, nodeId, current.engine.cols(), sign);
      renderAiOverlay(current);

      return;
    }

    state.ai.value = { enabled: true, pending: true };

    try {
      if (!(await ensureModel())) {
        if (requestId === aiRequestId) {
          state.ai.value = { enabled: false, pending: false };
        }

        return;
      }

      const position = aiPositionFromEngine(current.engine, options.getKomi());
      const result = await analyzePositionDirect(position);

      if (
        requestId !== aiRequestId ||
        state.board.value !== current ||
        !state.ai.value.enabled ||
        current.engine.current_node_id() !== nodeId ||
        !canRunAiSuggestion(current)
      ) {
        return;
      }

      applyAiSuggestion(result, nodeId, position.boardSize, sign);
      aiEvalCache.set(nodeId, {
        result,
        ownership: result.analysis.ownership,
        overlay: buildAiOwnershipOverlay(current, result.analysis.ownership),
      });
      renderAiOverlay(current);
    } catch (err) {
      if (
        requestId !== aiRequestId ||
        state.board.value !== current ||
        !state.ai.value.enabled ||
        current.engine.current_node_id() !== nodeId ||
        !canRunAiSuggestion(current)
      ) {
        return;
      }

      state.ai.value = {
        enabled: true,
        pending: false,
        error: err instanceof Error ? err.message : String(err),
        nodeId,
      };
      renderAiOverlay(current);
    }
  }

  function toggleAiSuggest() {
    const enabled = !state.ai.value.enabled;
    state.ai.value = {
      ...state.ai.value,
      enabled,
    };

    if (enabled) {
      refreshAiSuggestion();
    } else {
      clearAiSuggestion();
    }
  }

  async function startTerritoryOverlay(mode: "estimate" | "review") {
    const current = board();

    if (!current) {
      return false;
    }

    const nodeId = current.engine.current_node_id();
    const requestId = ++aiTerritoryRequestId;
    const enterOverlay = () => {
      if (mode === "estimate") {
        current.setPassiveOverlay(state.estimate.value.overlay);
      } else {
        current.enterTerritoryReview();
      }
    };

    if (!aiAllowed(current)) {
      state.estimate.value = { pending: false, mode, nodeId };
      if (mode === "estimate") {
        current.enterEstimate();
      } else {
        current.enterTerritoryReview();
      }

      return true;
    }

    const cacheKey = estimateCacheKey(current, options.getKomi());
    const cachedEval = aiEstimateCache.get(cacheKey);

    if (cachedEval?.overlay) {
      state.estimate.value = {
        pending: false,
        mode,
        nodeId,
        result: cachedEval.result,
        ownership: cachedEval.ownership,
        overlay: cachedEval.overlay,
      };
      enterOverlay();

      return true;
    }

    state.estimate.value = {
      pending: true,
      mode,
      nodeId,
    };

    try {
      if (!(await ensureModel())) {
        state.estimate.value = {
          pending: false,
          mode,
          nodeId,
        };
        if (mode === "estimate") {
          current.enterEstimate();
        } else {
          enterOverlay();
        }

        return true;
      }

      const position = aiEstimatePositionFromEngine(
        current.engine,
        options.getKomi(),
      );
      const result = await analyzePositionDirect(position);
      const ownership = result.analysis.ownership;

      if (
        requestId !== aiTerritoryRequestId ||
        state.board.value !== current ||
        current.engine.current_node_id() !== nodeId
      ) {
        return;
      }

      if (!ownership) {
        state.estimate.value = {
          pending: false,
          mode,
          nodeId,
        };
        if (mode === "estimate") {
          current.enterEstimate();
        } else {
          enterOverlay();
        }

        return;
      }

      const overlay = buildAiOwnershipOverlay(current, ownership);
      state.estimate.value = {
        pending: false,
        mode,
        nodeId,
        result,
        ownership,
        overlay,
      };
      aiEstimateCache.set(cacheKey, { result, ownership, overlay });
      enterOverlay();
    } catch {
      if (
        requestId !== aiTerritoryRequestId ||
        state.board.value !== current ||
        current.engine.current_node_id() !== nodeId
      ) {
        return;
      }

      state.estimate.value = {
        pending: false,
        mode,
        nodeId,
      };
      if (mode === "estimate") {
        current.enterEstimate();
      } else {
        enterOverlay();
      }
    }

    return true;
  }

  function toggleEstimate() {
    if (estimateModeActive()) {
      clearEstimate();
      board()?.exitTerritoryReview();

      return;
    }

    void startTerritoryOverlay("estimate");
  }

  function refreshAfterPositionChange() {
    const refreshEstimate = estimateModeActive();
    const current = board();

    clearAiSuggestion(false);

    if (refreshEstimate) {
      current?.setPassiveOverlay(undefined);
      void startTerritoryOverlay("estimate");
    } else {
      refreshAiSuggestion();
    }
  }

  function onNavigate() {
    clearPendingMove();
  }

  function onVertexClick(col: number, row: number) {
    if (!moveConfirm.enabled) {
      return false;
    }

    const current = board();
    const action = handleMoveConfirmClick(
      moveConfirm,
      col,
      row,
      !!current?.engine.is_legal(col, row),
    );

    syncPendingMove();

    if (action === "confirm") {
      return false;
    }

    current?.render();

    return true;
  }

  function confirmPendingMove() {
    const current = board();

    if (!state.pendingMove.value || !current) {
      return;
    }

    const [col, row] = state.pendingMove.value;
    const oldTreeNodeCount = current.engine.tree_node_count();

    clearPendingMove();

    if (current.engine.try_play(col, row)) {
      if (current.engine.tree_node_count() > oldTreeNodeCount) {
        options.onPlaySound?.();
      }
      current.save();
      current.render();
    }
  }

  function onStonePlay() {
    clearPendingMove();
    options.onPlaySound?.();
  }

  function onPass() {
    clearPendingMove();
    options.onPassSound?.();
  }

  function pass() {
    board()?.pass();
  }

  function onTerritoryReviewStart() {
    void startTerritoryOverlay("review");

    return true;
  }

  function onRender(_engine: unknown, territoryInfo: TerritoryInfo) {
    const current = board();

    if (!current) {
      return;
    }

    const nodeId = current.engine.current_node_id();
    const positionChanged =
      lastRenderedNodeId !== undefined && lastRenderedNodeId !== nodeId;

    lastRenderedNodeId = nodeId;
    state.territoryInfo.value = territoryInfo;
    state.nav.value = {
      atStart: current.engine.is_at_start(),
      atLatest: current.engine.is_at_latest(),
      atMainEnd: current.engine.is_at_main_end(),
      counter: `${current.engine.view_index()}`,
      boardTurnStone: current.engine.current_turn_stone(),
      boardLastMoveWasPass: current.engine.last_move_was_pass(),
    };
    options.onRender?.(current, territoryInfo);

    if (positionChanged) {
      refreshAfterPositionChange();
    }

    if (territoryInfo.confirming) {
      clearAiSuggestion(false);
    } else {
      refreshAiSuggestion();
    }
  }

  function clearVariations() {
    clearAiCaches();
    options.onClearVariations?.();
  }

  function resetPositionTracking() {
    lastRenderedNodeId = undefined;
  }

  return {
    state,
    aiGhostStoneOverlay,
    aiHeatOverlay,
    aiTerritoryOwnership,
    clearAiCaches,
    clearAiSuggestion,
    clearEstimate,
    clearPendingMove,
    clearVariations,
    confirmPendingMove,
    getGhostStone,
    onNavigate,
    onPass,
    onRender,
    onStonePlay,
    onTerritoryReviewStart,
    onVertexClick,
    pass,
    resetPositionTracking,
    startTerritoryOverlay,
    syncPendingMove,
    toggleAiSuggest,
    toggleEstimate,
  };
}
