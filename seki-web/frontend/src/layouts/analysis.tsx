import { render, createRef } from "preact";
import { effect } from "@preact/signals";
import { createBoard, ensureWasm } from "../goban/create-board";
import { readShowCoordinates } from "../utils/coord-toggle";
import {
  storage,
  ANALYSIS_SIZE,
  ANALYSIS_KOMI,
  ANALYSIS_SGF_META,
  ANALYSIS_SGF_TEXT,
  analysisTreeKey,
} from "../utils/storage";
import { playStoneSound, playPassSound } from "../game/sound";
import {
  createMoveConfirm,
  handleMoveConfirmClick,
  dismissMoveConfirmOnClickOutside,
} from "../utils/move-confirm";
import { todayYYYYMMDD, formatSgfTime, formatTime } from "../utils/format";
import { readFileAsText, downloadSgf } from "../utils/sgf";
import type { SgfMeta } from "../utils/sgf";
import type { Sign } from "../goban/types";
import type { PlayerPanelProps } from "../components/player-panel";
import { buildPlayerPanels } from "../game/capabilities";
import {
  analysisBoard,
  analysisKomi,
  analysisMeta,
  analysisPendingMove,
  analysisPanelState,
  analysisSize,
  analysisTerritoryInfo,
  analysisNavState,
  resetAnalysisRuntimeState,
} from "./analysis-state";
import { mobileTab, showCoordinates } from "../game/state";
import { AnalysisPage } from "./analysis-page";

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

  // --- Komi change ---
  function handleKomiChange(komi: number) {
    analysisKomi.value = komi;
    storage.set(ANALYSIS_KOMI, String(komi));
    analysisBoard.value?.setKomi(komi);
  }

  function buildAnalysisPanels(board: NonNullable<typeof analysisBoard.value>): {
    top: PlayerPanelProps;
    bottom: PlayerPanelProps;
  } {
    const engine = board.engine;
    const meta = analysisMeta.value;
    const { score } = analysisTerritoryInfo.value;
    const whiteName = meta?.white_name ?? "White";
    const blackName = meta?.black_name ?? "Black";

    const mtJson = engine.current_move_time();
    let bClock = "";
    let wClock = "";
    if (mtJson) {
      const mt = JSON.parse(mtJson) as {
        black_time?: number;
        black_periods?: number;
        white_time?: number;
        white_periods?: number;
      };
      if (mt.black_time != null) {
        bClock = formatTime(mt.black_time);
        if (mt.black_periods != null) {
          bClock += ` (${mt.black_periods})`;
        }
      }
      if (mt.white_time != null) {
        wClock = formatTime(mt.white_time);
        if (mt.white_periods != null) {
          wClock += ` (${mt.white_periods})`;
        }
      }
    }
    if (!bClock && !wClock) {
      const fallback =
        formatSgfTime(meta?.time_limit_secs, meta?.overtime) ?? "";
      bClock = fallback;
      wClock = fallback;
    }

    const panels = buildPlayerPanels({
      komi: analysisKomi.value,
      captures: {
        black: engine.captures_black(),
        white: engine.captures_white(),
      },
      score,
    });

    return {
      top: {
        ...panels.white,
        name: whiteName,
        stone: "white",
        clock: wClock,
      },
      bottom: {
        ...panels.black,
        name: blackName,
        stone: "black",
        clock: bClock,
      },
    };
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
    analysisPanelState.value = buildAnalysisPanels(board);
  }

  // --- Size change ---
  function handleSizeChange(size: number) {
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
        clearPendingMove();
        playStoneSound();
      },
      onPass: () => {
        clearPendingMove();
        playPassSound();
      },
      onRender: (engine, territoryInfo) => {
        analysisTerritoryInfo.value = territoryInfo;
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
      handleSgfImport={handleSgfImport}
      handleSgfExport={handleSgfExport}
    />,
    root,
  );

  initBoard(analysisSize.value);

  return () => {
    disposed = true;
    boardInitVersion += 1;
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
