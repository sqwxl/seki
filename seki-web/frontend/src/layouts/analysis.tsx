import { effect } from "@preact/signals";
import { createRef, render } from "preact";
import { analyzePositionDirect } from "../ai/analyze";
import {
  ghostStoneMapFromRootMoves,
  heatMapFromRootMoves,
} from "../ai/heatmap";
import { aiPositionFromEngine } from "../ai/position";
import { analysisCapabilities } from "../game/capabilities";
import { playPassSound, playStoneSound } from "../game/sound";
import { mobileTab, showCoordinates } from "../game/state";
import { GameStage } from "../game/types";
import {
  createBoard,
  ensureWasm,
  type TerritoryOverlay,
} from "../goban/create-board";
import type { Sign } from "../goban/types";
import { readShowCoordinates } from "../utils/coord-toggle";
import { todayYYYYMMDD } from "../utils/format";
import {
  createMoveConfirm,
  dismissMoveConfirmOnClickOutside,
  handleMoveConfirmClick,
} from "../utils/move-confirm";
import type { SgfMeta } from "../utils/sgf";
import { downloadSgf, readFileAsText } from "../utils/sgf";
import {
  ANALYSIS_KOMI,
  ANALYSIS_SGF_META,
  ANALYSIS_SGF_TEXT,
  ANALYSIS_SIZE,
  analysisTreeKey,
  storage,
} from "../utils/storage";
import { AnalysisPage } from "./analysis-page";
import { buildAnalysisPanels } from "./analysis-panels";
import {
  analysisAiState,
  analysisAiTerritoryState,
  analysisBoard,
  analysisKomi,
  analysisMeta,
  analysisNavState,
  analysisPanelState,
  analysisPendingMove,
  analysisSize,
  analysisTerritoryInfo,
  resetAnalysisRuntimeState,
} from "./analysis-state";

const VALID_SIZES = [9, 13, 19];

export function initAnalysis(root: HTMLElement) {
  const gobanRef = createRef<HTMLDivElement>();
  const moveTreeEl = document.createElement("div");

  moveTreeEl.className = "move-tree";

  // Restore persisted state into signals
  const savedSize = storage.get(ANALYSIS_SIZE);
  let parsed = savedSize ? parseInt(savedSize, 10) : 19;

  if (!VALID_SIZES.includes(parsed)) {
    parsed = 19;
  }

  analysisSize.value = parsed;

  const savedKomi = storage.get(ANALYSIS_KOMI);

  analysisKomi.value = savedKomi != null ? parseFloat(savedKomi) : 6.5;
  analysisMeta.value = storage.getJson(ANALYSIS_SGF_META);

  let sgfText: string | undefined = storage.get(ANALYSIS_SGF_TEXT) ?? undefined;
  let disposed = false;
  let boardInitVersion = 0;
  let aiRequestId = 0;
  let aiTerritoryRequestId = 0;
  const aiEvalCache = new Map<
    number,
    {
      result: Awaited<ReturnType<typeof analyzePositionDirect>>;
      ownership?: number[];
      overlay?: TerritoryOverlay;
    }
  >();

  showCoordinates.value = readShowCoordinates();

  const mc = createMoveConfirm({
    getSign: () =>
      (analysisBoard.value?.engine.current_turn_stone() ?? 1) as Sign,
  });

  function syncPendingMove() {
    analysisPendingMove.value = mc.value;
  }

  function clearPendingMove() {
    mc.clear();
    analysisPendingMove.value = undefined;
  }

  function ghostStone() {
    return mc.getGhostStone();
  }

  function aiHeatOverlay() {
    const board = analysisBoard.value;
    const state = analysisAiState.value;

    if (!board || state.nodeId !== board.engine.current_node_id()) {
      return undefined;
    }

    return state.heatMap;
  }

  function aiGhostStoneOverlay() {
    const board = analysisBoard.value;
    const state = analysisAiState.value;

    if (!board || state.nodeId !== board.engine.current_node_id()) {
      return undefined;
    }

    return state.ghostStoneMap;
  }

  function aiTerritoryOwnership() {
    const board = analysisBoard.value;
    const state = analysisAiTerritoryState.value;
    const ownership = state.ownership;

    if (
      !board ||
      state.nodeId !== board.engine.current_node_id() ||
      !ownership
    ) {
      return undefined;
    }

    const size = board.engine.cols() * board.engine.rows();

    if (ownership.length !== size) {
      return undefined;
    }

    return ownership.map((value) =>
      Number.isFinite(value) ? Math.max(-1, Math.min(1, value)) : 0,
    );
  }

  function buildAiOwnershipOverlay(
    ownership: number[] | undefined,
  ): TerritoryOverlay | undefined {
    const board = analysisBoard.value;

    if (!board || !ownership) {
      return undefined;
    }

    const cols = board.engine.cols();
    const rows = board.engine.rows();
    const size = cols * rows;

    if (ownership.length !== size) {
      return undefined;
    }

    const stones = [...board.engine.board()] as number[];
    const paintMap: (number | null)[] = new Array(size);
    const dimmedVertices: [number, number][] = [];

    for (let index = 0; index < size; index++) {
      const owner = Number.isFinite(ownership[index])
        ? Math.max(-1, Math.min(1, ownership[index]!))
        : 0;
      const stone = stones[index] ?? 0;

      if (stone !== 0 && owner !== 0) {
        if (Math.sign(stone) !== Math.sign(owner)) {
          dimmedVertices.push([index % cols, Math.floor(index / cols)]);
        }
      }
      paintMap[index] = owner || null;
    }

    return { paintMap, dimmedVertices };
  }

  function canRunAiSuggestion(board = analysisBoard.value) {
    return (
      !!board &&
      analysisSize.value === 9 &&
      !analysisTerritoryInfo.value.confirming &&
      board.engine.stage() !== GameStage.TerritoryReview
    );
  }

  function hasFreshAiSuggestion(board = analysisBoard.value) {
    const state = analysisAiState.value;

    return (
      !!board &&
      !state.pending &&
      (state.result || state.error) &&
      state.nodeId === board.engine.current_node_id()
    );
  }

  function refreshAiSuggestion() {
    const board = analysisBoard.value;

    if (
      analysisAiState.value.enabled &&
      canRunAiSuggestion(board) &&
      !hasFreshAiSuggestion(board)
    ) {
      aiSuggest();
    }
  }

  function clearAiSuggestion(renderBoard = true) {
    const state = analysisAiState.value;

    if (
      state.pending ||
      state.result ||
      state.error ||
      state.heatMap ||
      state.ghostStoneMap
    ) {
      aiRequestId += 1;
      analysisAiState.value = {
        enabled: analysisAiState.value.enabled,
        pending: false,
      };

      if (renderBoard) {
        analysisBoard.value?.render();
      }
    }
  }

  function clearAiTerritoryOwnership() {
    aiTerritoryRequestId += 1;
    analysisAiTerritoryState.value = { pending: false };
  }

  function clearAiEvalCache() {
    aiEvalCache.clear();
    clearAiTerritoryOwnership();
  }

  // --- Komi change ---
  function handleKomiChange(komi: number) {
    analysisKomi.value = komi;
    storage.set(ANALYSIS_KOMI, String(komi));
    analysisBoard.value?.setKomi(komi);
    clearAiSuggestion();
    clearAiEvalCache();
  }

  function handleAiSuggestChange() {
    const enable = !analysisAiState.value.enabled;
    analysisAiState.value = {
      ...analysisAiState.value,
      enabled: enable,
    };

    if (enable) {
      refreshAiSuggestion();
    } else {
      clearAiSuggestion();
    }
  }

  async function aiSuggest() {
    const board = analysisBoard.value;

    if (
      !board ||
      !analysisAiState.value.enabled ||
      analysisAiState.value.pending ||
      !canRunAiSuggestion(board)
    ) {
      return;
    }

    const requestId = ++aiRequestId;
    const nodeId = board.engine.current_node_id();
    const position = aiPositionFromEngine(board.engine, analysisKomi.value);
    const sign = board.engine.current_turn_stone() as Sign;
    const cached = analysisAiTerritoryState.value;

    const cachedEval = aiEvalCache.get(nodeId);

    if (cachedEval) {
      applyAiSuggestion(cachedEval.result, nodeId, position.boardSize, sign);
      board.render();

      return;
    }

    analysisAiState.value = { enabled: true, pending: true };

    try {
      const result = await analyzePositionDirect(position);

      if (
        requestId !== aiRequestId ||
        analysisBoard.value !== board ||
        !analysisAiState.value.enabled ||
        board.engine.current_node_id() !== nodeId ||
        !canRunAiSuggestion(board)
      ) {
        return;
      }

      analysisAiState.value = {
        enabled: true,
        pending: false,
        result,
        nodeId,
        heatMap: heatMapFromRootMoves(
          result.analysis.rootMoves,
          position.boardSize,
        ),
        ghostStoneMap: ghostStoneMapFromRootMoves(
          result.analysis.rootMoves,
          position.boardSize,
          sign,
        ),
      };
      analysisAiTerritoryState.value = {
        ...analysisAiTerritoryState.value,
        pending: false,
        result,
        nodeId,
        ownership: result.analysis.ownership,
        overlay: buildAiOwnershipOverlay(result.analysis.ownership),
      };
      aiEvalCache.set(nodeId, {
        result,
        ownership: result.analysis.ownership,
        overlay: analysisAiTerritoryState.value.overlay,
      });
      board.render();
    } catch (err) {
      if (
        requestId !== aiRequestId ||
        analysisBoard.value !== board ||
        !analysisAiState.value.enabled ||
        board.engine.current_node_id() !== nodeId ||
        !canRunAiSuggestion(board)
      ) {
        return;
      }

      analysisAiState.value = {
        enabled: true,
        pending: false,
        error: err instanceof Error ? err.message : String(err),
        nodeId,
      };
      board.render();
    }
  }

  function applyAiSuggestion(
    result: Awaited<ReturnType<typeof analyzePositionDirect>>,
    nodeId: number,
    boardSize: number,
    sign: Sign,
  ) {
    analysisAiState.value = {
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

  async function startTerritoryOverlay(mode: "estimate" | "review") {
    const board = analysisBoard.value;

    if (!board) {
      return false;
    }

    const nodeId = board.engine.current_node_id();
    const canUseAi = analysisSize.value === 9;
    const requestId = ++aiTerritoryRequestId;
    const enterOverlay = () => {
      if (mode === "estimate") {
        board.setPassiveOverlay(analysisAiTerritoryState.value.overlay);
      } else {
        board.enterTerritoryReview();
      }
    };

    if (!canUseAi) {
      analysisAiTerritoryState.value = {
        pending: false,
        mode,
        nodeId,
      };
      if (mode === "estimate") {
        board.enterEstimate();
      } else {
        enterOverlay();
      }

      return true;
    }

    const cachedEval = aiEvalCache.get(nodeId);

    if (cachedEval?.overlay) {
      analysisAiTerritoryState.value = {
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

    if (
      analysisAiState.value.nodeId === nodeId &&
      analysisAiState.value.result?.analysis.ownership
    ) {
      const overlay = buildAiOwnershipOverlay(
        analysisAiState.value.result.analysis.ownership,
      );
      const cached = {
        result: analysisAiState.value.result,
        ownership: analysisAiState.value.result.analysis.ownership,
        overlay,
      };
      aiEvalCache.set(nodeId, cached);
      analysisAiTerritoryState.value = {
        pending: false,
        mode,
        nodeId,
        result: cached.result,
        ownership: cached.ownership,
        overlay,
      };
      enterOverlay();

      return true;
    }

    const position = aiPositionFromEngine(board.engine, analysisKomi.value);
    analysisAiTerritoryState.value = {
      pending: true,
      mode,
      nodeId,
    };

    try {
      const result = await analyzePositionDirect(position);
      const ownership = result.analysis.ownership;

      if (
        requestId !== aiTerritoryRequestId ||
        analysisBoard.value !== board ||
        board.engine.current_node_id() !== nodeId
      ) {
        return;
      }

      if (!ownership) {
        analysisAiTerritoryState.value = {
          pending: false,
          mode,
          nodeId,
        };
        if (mode === "estimate") {
          board.enterEstimate();
        } else {
          enterOverlay();
        }

        return;
      }

      const overlay = buildAiOwnershipOverlay(ownership);
      analysisAiTerritoryState.value = {
        pending: false,
        mode,
        nodeId,
        result,
        ownership,
        overlay,
      };
      aiEvalCache.set(nodeId, { result, ownership, overlay });
      if (analysisAiState.value.enabled) {
        applyAiSuggestion(
          result,
          nodeId,
          position.boardSize,
          board.engine.current_turn_stone() as Sign,
        );
      }
      enterOverlay();
    } catch {
      if (
        requestId !== aiTerritoryRequestId ||
        analysisBoard.value !== board ||
        board.engine.current_node_id() !== nodeId
      ) {
        return;
      }

      analysisAiTerritoryState.value = {
        pending: false,
        mode,
        nodeId,
      };
      if (mode === "estimate") {
        board.enterEstimate();
      } else {
        enterOverlay();
      }
    }

    return true;
  }

  function handleEstimate() {
    void startTerritoryOverlay("estimate");
  }

  function handleTerritoryReviewStart() {
    void startTerritoryOverlay("review");

    return true;
  }

  function syncAnalysisUi(board: NonNullable<typeof analysisBoard.value>) {
    const engine = board.engine;
    analysisNavState.value = {
      atStart: engine.is_at_start(),
      atLatest: engine.is_at_latest(),
      atMainEnd: engine.is_at_main_end(),
      counter: `${engine.view_index()}`,
      boardTurnStone: engine.current_turn_stone(),
      boardLastMoveWasPass: engine.last_move_was_pass(),
    };
    analysisPanelState.value = buildAnalysisPanels({
      board,
      meta: analysisMeta.value,
      komi: analysisKomi.value,
      territoryInfo: analysisTerritoryInfo.value,
    });
  }

  // --- Size change ---
  function handleSizeChange(size: number) {
    clearAiSuggestion(false);
    clearAiEvalCache();
    analysisSize.value = size;
    analysisMeta.value = undefined;
    sgfText = undefined;
    storage.remove(ANALYSIS_SGF_META);
    storage.remove(ANALYSIS_SGF_TEXT);
    storage.set(ANALYSIS_SIZE, String(size));
    initBoard(size);
  }

  // --- Board initialization ---
  async function initBoard(size: number) {
    const initVersion = ++boardInitVersion;

    if (analysisBoard.value) {
      analysisBoard.value.destroy();
    }

    clearPendingMove();
    analysisBoard.value = undefined;

    const board = await createBoard({
      cols: size,
      rows: size,
      showCoordinates: showCoordinates.value,
      gobanEl: gobanRef.current!,
      komi: analysisKomi.value,
      moveTreeEl,
      moveTreeDirection: "responsive",
      storageKey: analysisTreeKey(size),
      ghostStone,
      ghostStoneOverlay: aiGhostStoneOverlay,
      territoryReviewOwnership: aiTerritoryOwnership,
      heatOverlay: aiHeatOverlay,
      onNavigate: () => {
        const keepEstimate =
          (analysisTerritoryInfo.value.estimating &&
            !analysisTerritoryInfo.value.confirming) ||
          (analysisAiTerritoryState.value.pending &&
            analysisAiTerritoryState.value.mode === "estimate");
        clearAiSuggestion(false);
        clearAiTerritoryOwnership();
        if (keepEstimate) {
          void startTerritoryOverlay("estimate");
        } else {
          refreshAiSuggestion();
        }
      },
      onVertexClick: (col, row) => {
        if (!mc.enabled) {
          return false;
        }

        const action = handleMoveConfirmClick(
          mc,
          col,
          row,
          !!analysisBoard.value?.engine.is_legal(col, row),
        );

        syncPendingMove();

        if (action === "confirm") {
          return false;
        }

        analysisBoard.value?.render();

        return true;
      },

      onStonePlay: () => {
        clearAiSuggestion(false);
        clearAiEvalCache();
        clearPendingMove();
        playStoneSound();
        refreshAiSuggestion();
      },
      onPass: () => {
        clearAiSuggestion(false);
        clearAiEvalCache();
        clearPendingMove();
        playPassSound();
        refreshAiSuggestion();
      },
      onTerritoryReviewStart: handleTerritoryReviewStart,
      onRender: (engine, territoryInfo) => {
        analysisTerritoryInfo.value = territoryInfo;
        if (territoryInfo.confirming) {
          clearAiSuggestion(false);
        } else {
          refreshAiSuggestion();
        }
        if (analysisBoard.value) {
          syncAnalysisUi(analysisBoard.value);
        }
      },
    });

    if (disposed || initVersion !== boardInitVersion) {
      board.destroy();

      return;
    }

    analysisBoard.value = board;
    syncAnalysisUi(board);

    // Restore move_times from saved SGF text (tree already restored via storageKey)
    if (sgfText) {
      board.engine.load_sgf_move_times(sgfText);
    }
  }

  // --- SGF import ---
  async function handleSgfImport(input: HTMLInputElement) {
    const file = input.files?.[0];

    if (!file) {
      return;
    }

    const text = await readFileAsText(file);
    const wasm = await ensureWasm();
    const metaJson = wasm.parse_sgf(text);
    const meta: SgfMeta = JSON.parse(metaJson);

    if (meta.error) {
      alert(`SGF error: ${meta.error}`);
      input.value = "";

      return;
    }

    if (meta.cols !== meta.rows) {
      alert("Non-square boards are not supported.");
      input.value = "";

      return;
    }

    const size = meta.cols;

    if (!VALID_SIZES.includes(size)) {
      alert(`Unsupported board size: ${size}×${size}`);
      input.value = "";

      return;
    }

    // Update signals + storage
    clearAiSuggestion(false);
    clearAiEvalCache();
    analysisSize.value = size;
    storage.set(ANALYSIS_SIZE, String(size));

    const treeKey = analysisTreeKey(size);

    storage.remove(treeKey);
    storage.remove(`${treeKey}:base`);
    storage.remove(`${treeKey}:finalized`);
    storage.remove(`${treeKey}:node`);
    analysisMeta.value = meta;
    sgfText = text;
    storage.setJson(ANALYSIS_SGF_META, meta);
    storage.set(ANALYSIS_SGF_TEXT, text);

    await initBoard(size);

    const board = analysisBoard.value;

    if (board) {
      board.engine.load_sgf_tree(text);
      board.engine.to_start();
      board.save();
      board.render();
    }

    input.value = "";
  }

  // --- SGF export ---
  function handleSgfExport() {
    const board = analysisBoard.value;

    if (!board) {
      return;
    }

    const meta: SgfMeta = {
      cols: analysisSize.value,
      rows: analysisSize.value,
      komi: analysisMeta.value?.komi ?? analysisKomi.value,
      handicap: analysisMeta.value?.handicap,
      black_name: analysisMeta.value?.black_name,
      white_name: analysisMeta.value?.white_name,
      game_name: analysisMeta.value?.game_name,
      result: analysisMeta.value?.result,
      time_limit_secs: analysisMeta.value?.time_limit_secs,
      overtime: analysisMeta.value?.overtime,
    };
    const sgf = board.engine.export_sgf(JSON.stringify(meta));
    const date = todayYYYYMMDD();
    const hasNames =
      analysisMeta.value?.black_name && analysisMeta.value?.white_name;
    const filename = analysisMeta.value?.game_name
      ? `${date}-${analysisMeta.value.game_name}`
      : hasNames
        ? `${date}-${analysisMeta.value!.black_name}-vs-${analysisMeta.value!.white_name}`
        : "analysis";

    downloadSgf(sgf, `${filename}.sgf`);
  }

  // --- Dismiss pending move confirmation on click outside goban ---
  const stopDismissOutside = dismissMoveConfirmOnClickOutside(
    mc,
    () => gobanRef.current,
    () => {
      analysisPendingMove.value = undefined;
      analysisBoard.value?.render();
    },
  );

  // --- Keyboard shortcuts ---
  const handleKeyDown = (e: KeyboardEvent) => {
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
    if (document.querySelector(".confirm-popover")) return;

    const board = analysisBoard.value;
    if (!board) return;

    const caps = analysisCapabilities.value;

    switch (e.key) {
      case "p":
        if (caps.canPass) {
          clearAiSuggestion(false);
          board.pass();
        }
        break;
      case "e":
        if (caps.showEstimate && caps.canEstimate) {
          handleEstimate();
        }
        break;
      case "Escape":
        if (
          analysisTerritoryInfo.value.reviewing ||
          analysisTerritoryInfo.value.estimating
        ) {
          board.exitTerritoryReview();
        }
        break;
    }
  };

  document.addEventListener("keydown", handleKeyDown);

  const disposers = [
    effect(() => {
      if (mobileTab.value === "board" && analysisBoard.value) {
        requestAnimationFrame(() => {
          analysisBoard.value?.render();
        });
      }
    }),
  ];

  resetAnalysisRuntimeState();
  render(
    <AnalysisPage
      gobanRef={gobanRef}
      mc={mc}
      moveTreeEl={moveTreeEl}
      onSizeChange={handleSizeChange}
      onKomiChange={handleKomiChange}
      onAiSuggestChange={handleAiSuggestChange}
      onEstimate={handleEstimate}
      aiSuggest={aiSuggest}
      handleSgfImport={handleSgfImport}
      handleSgfExport={handleSgfExport}
    />,
    root,
  );

  initBoard(analysisSize.value);

  return () => {
    disposed = true;
    boardInitVersion += 1;
    document.removeEventListener("keydown", handleKeyDown);

    for (const dispose of disposers) {
      dispose();
    }

    stopDismissOutside();
    analysisBoard.value?.destroy();
    analysisBoard.value = undefined;
    resetAnalysisRuntimeState();
    render(null, root);
  };
}
