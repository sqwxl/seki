import { effect } from "@preact/signals";
import { createRef, render } from "preact";
import { analysisCapabilities } from "../game/capabilities";
import { playPassSound, playStoneSound } from "../game/sound";
import { mobileTab, showCoordinates } from "../game/state";
import { createBoard, ensureWasm } from "../goban/create-board";
import type { Sign } from "../goban/types";
import { readShowCoordinates } from "../utils/coord-toggle";
import { todayYYYYMMDD } from "../utils/format";
import {
  createMoveConfirm,
  dismissMoveConfirmOnClickOutside,
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
import { createAnalysisSessionController } from "./analysis-session/controller";
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
  showCoordinates.value = readShowCoordinates();

  const mc = createMoveConfirm({
    getSign: () =>
      (analysisBoard.value?.engine.current_turn_stone() ?? 1) as Sign,
  });

  const session = createAnalysisSessionController({
    state: {
      board: analysisBoard,
      pendingMove: analysisPendingMove,
      ai: analysisAiState,
      estimate: analysisAiTerritoryState,
      territoryInfo: analysisTerritoryInfo,
      nav: analysisNavState,
    },
    moveConfirm: mc,
    getKomi: () => analysisKomi.value,
    onRender: syncAnalysisUi,
    onPlaySound: playStoneSound,
    onPassSound: playPassSound,
    onClearVariations: clearDedicatedVariations,
  });

  // --- Komi change ---
  function handleKomiChange(komi: number) {
    analysisKomi.value = komi;
    storage.set(ANALYSIS_KOMI, String(komi));
    analysisBoard.value?.setKomi(komi);
    session.clearAiCaches();
  }

  function handleAiSuggestChange() {
    session.toggleAiSuggest();
  }

  function handleEstimate() {
    session.toggleEstimate();
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
    session.clearAiCaches();
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

    session.clearPendingMove();
    analysisBoard.value = undefined;
    session.resetPositionTracking();

    const board = await createBoard({
      cols: size,
      rows: size,
      showCoordinates: showCoordinates.value,
      gobanEl: gobanRef.current!,
      komi: analysisKomi.value,
      moveTreeEl,
      moveTreeDirection: "responsive",
      storageKey: analysisTreeKey(size),
      ghostStone: session.getGhostStone,
      ghostStoneOverlay: session.aiGhostStoneOverlay,
      territoryReviewOwnership: session.aiTerritoryOwnership,
      heatOverlay: session.aiHeatOverlay,
      onNavigate: session.onNavigate,
      onVertexClick: session.onVertexClick,
      onStonePlay: session.onStonePlay,
      onPass: session.onPass,
      onTerritoryReviewStart: session.onTerritoryReviewStart,
      onRender: session.onRender,
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
    session.clearAiCaches();
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

  // --- Clear variations ---
  function clearDedicatedVariations() {
    const treeKey = analysisTreeKey(analysisSize.value);

    storage.remove(treeKey);
    storage.remove(`${treeKey}:base`);
    storage.remove(`${treeKey}:finalized`);
    storage.remove(`${treeKey}:node`);
    initBoard(analysisSize.value);
  }

  function handleClearVariations() {
    session.clearVariations();
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
      session.clearPendingMove();
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
          session.pass();
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
      onConfirmMove={session.confirmPendingMove}
      onPass={session.pass}
      handleSgfImport={handleSgfImport}
      handleSgfExport={handleSgfExport}
      handleClearVariations={handleClearVariations}
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
