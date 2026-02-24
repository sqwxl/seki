import { render, createRef } from "preact";
import { createBoard, ensureWasm } from "../goban/create-board";
import { readShowCoordinates } from "../utils/coord-toggle";
import {
  storage,
  ANALYSIS_SIZE,
  ANALYSIS_SGF_META,
  ANALYSIS_SGF_TEXT,
  analysisTreeKey,
} from "../utils/storage";
import { playStoneSound, playPassSound } from "../game/sound";
import { createPremove } from "../utils/premove";
import type { CoordsToggleState } from "../utils/shared-controls";
import { readFileAsText, downloadSgf } from "../utils/sgf";
import type { SgfMeta } from "../utils/sgf";
import type { Sign } from "../goban/types";
import {
  analysisBoard,
  analysisMeta,
  analysisSize,
  analysisTerritoryInfo,
} from "./analysis-state";
import { AnalysisPage } from "./analysis-page";

const VALID_SIZES = [9, 13, 19];
const KOMI = 6.5;

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
  analysisMeta.value = storage.getJson(ANALYSIS_SGF_META);

  let sgfText: string | undefined = storage.get(ANALYSIS_SGF_TEXT) ?? undefined;

  const coordsState: CoordsToggleState = {
    showCoordinates: readShowCoordinates(),
  };

  const pm = createPremove({
    getSign: () =>
      (analysisBoard.value?.engine.current_turn_stone() ?? 1) as Sign,
  });

  function ghostStone() {
    return pm.getGhostStone();
  }

  // --- Render ---
  function doRender() {
    render(
      <AnalysisPage
        gobanRef={gobanRef}
        pm={pm}
        coordsState={coordsState}
        moveTreeEl={moveTreeEl}
        onSizeChange={handleSizeChange}
        handleSgfImport={handleSgfImport}
        handleSgfExport={handleSgfExport}
      />,
      root,
    );
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
    if (analysisBoard.value) {
      analysisBoard.value.destroy();
    }
    pm.clear();
    analysisBoard.value = undefined;

    // Render layout first so the goban div exists
    doRender();

    const board = await createBoard({
      cols: size,
      rows: size,
      showCoordinates: coordsState.showCoordinates,
      gobanEl: gobanRef.current!,
      komi: KOMI,
      moveTreeEl,
      moveTreeDirection: "responsive",
      storageKey: analysisTreeKey(size),
      ghostStone,
      onVertexClick: (col, row) => {
        if (!pm.enabled) {
          return false;
        }
        if (pm.value && pm.value[0] === col && pm.value[1] === row) {
          pm.clear();
          doRender();
          return false;
        }
        pm.value = [col, row];
        doRender();
        analysisBoard.value?.render();
        return true;
      },
      onStonePlay: () => {
        pm.clear();
        playStoneSound();
      },
      onPass: () => {
        pm.clear();
        playPassSound();
      },
      onRender: (_engine, territoryInfo) => {
        analysisTerritoryInfo.value = territoryInfo;
        doRender();
      },
    });

    analysisBoard.value = board;

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
      komi: analysisMeta.value?.komi ?? KOMI,
      handicap: analysisMeta.value?.handicap,
      black_name: analysisMeta.value?.black_name,
      white_name: analysisMeta.value?.white_name,
      game_name: analysisMeta.value?.game_name,
      result: analysisMeta.value?.result,
      time_limit_secs: analysisMeta.value?.time_limit_secs,
      overtime: analysisMeta.value?.overtime,
    };
    const sgf = board.engine.export_sgf(JSON.stringify(meta));
    const filename =
      analysisMeta.value?.game_name ??
      (analysisMeta.value?.black_name && analysisMeta.value?.white_name
        ? `${analysisMeta.value.black_name}-vs-${analysisMeta.value.white_name}`
        : "analysis");
    downloadSgf(sgf, `${filename}.sgf`);
  }

  initBoard(analysisSize.value);
}
