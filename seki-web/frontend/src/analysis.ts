import { createBoard, ensureWasm, findNavButtons } from "./board";
import type { Board } from "./board";
import { readShowCoordinates, setupCoordToggle } from "./coord-toggle";
import { formatScoreStr, setLabel } from "./game-ui";
import {
  formatPoints,
  formatSgfTime,
  formatTime,
} from "./format";
import { queryGameDom } from "./game-dom";
import { playStoneSound, playPassSound } from "./game-sound";
import { readFileAsText, downloadSgf } from "./sgf-io";
import type { SgfMeta } from "./sgf-io";
import {
  setIcon, setIconAll, asteriskSvg,
  playbackPrevSvg, playbackRewindSvg, playbackForwardSvg, playbackNextSvg,
  fileUploadSvg, fileExportSvg,
} from "./icons";

const SIZE_KEY = "seki:analysis:size";
const SGF_META_KEY = "seki:analysis:sgfMeta";
const SGF_TEXT_KEY = "seki:analysis:sgfText";
const VALID_SIZES = [9, 13, 19];
const KOMI = 6.5;

export function initAnalysis(root: HTMLElement) {
  const {
    goban: gobanEl,
    playerTop: playerTopEl,
    playerBottom: playerBottomEl,
  } = queryGameDom();
  const sizeSelect = document.getElementById(
    "board-size",
  ) as HTMLSelectElement | null;

  // --- Populate SVG icons ---
  setIcon("start-btn", playbackPrevSvg);
  setIcon("back-btn", playbackRewindSvg);
  setIcon("forward-btn", playbackForwardSvg);
  setIcon("end-btn", playbackNextSvg);
  setIcon("sgf-import-label", fileUploadSvg);
  setIcon("sgf-export", fileExportSvg);
  setIconAll(".turn-indicator", asteriskSvg);

  // Territory UI elements
  const playControls = document.getElementById("play-controls");
  const territoryControls = document.getElementById("territory-controls");
  const scoreBtn = document.getElementById(
    "score-btn",
  ) as HTMLButtonElement | null;
  const readyBtn = document.getElementById(
    "territory-ready-btn",
  ) as HTMLButtonElement | null;
  const exitBtn = document.getElementById(
    "territory-exit-btn",
  ) as HTMLButtonElement | null;

  const savedSize = localStorage.getItem(SIZE_KEY);
  let currentSize = savedSize ? parseInt(savedSize, 10) : 19;
  if (!VALID_SIZES.includes(currentSize)) {
    currentSize = 19;
  }
  if (sizeSelect) {
    sizeSelect.value = String(currentSize);
  }

  let board: Board | undefined;
  let territoryAbort: AbortController | undefined;
  let sgfMeta: SgfMeta | undefined;
  let sgfText: string | undefined;

  // Restore saved SGF metadata and text
  const savedMeta = localStorage.getItem(SGF_META_KEY);
  if (savedMeta) {
    try {
      sgfMeta = JSON.parse(savedMeta);
    } catch { /* ignore */ }
  }
  sgfText = localStorage.getItem(SGF_TEXT_KEY) ?? undefined;

  const showCoordinates = readShowCoordinates();
  setupCoordToggle(() => board);

  function updateControls(reviewing: boolean, finalized: boolean) {
    if (playControls) {
      playControls.style.display =
        reviewing ? "none" : "flex";
    }
    if (territoryControls) {
      territoryControls.style.display =
        reviewing ? "flex" : "none";
    }
    // When finalized, hide action buttons but keep nav and reset visible
    if (finalized && playControls) {
      const scoreEl = playControls.querySelector("#score-btn");
      const passEl = playControls.querySelector("#pass-btn");
      if (scoreEl) {
        (scoreEl as HTMLElement).style.display = "none";
      }
      if (passEl) {
        (passEl as HTMLElement).style.display = "none";
      }
    } else if (playControls) {
      const scoreEl = playControls.querySelector("#score-btn");
      const passEl = playControls.querySelector("#pass-btn");
      if (scoreEl) {
        (scoreEl as HTMLElement).style.display = "";
      }
      if (passEl) {
        (passEl as HTMLElement).style.display = "";
      }
    }
  }

  async function initBoard(size: number) {
    if (board) {
      board.destroy();
    }
    territoryAbort?.abort();
    territoryAbort = new AbortController();
    const tOpts = { signal: territoryAbort.signal };
    gobanEl.style.aspectRatio = `${size}/${size}`;

    board = await createBoard({
      cols: size,
      rows: size,
      showCoordinates,
      gobanEl,
      komi: KOMI,
      moveTreeEl: document.getElementById("move-tree"),
      moveTreeDirection: "responsive",
      storageKey: `seki:analysis:tree:${size}`,
      navButtons: findNavButtons(),
      buttons: {
        pass: document.getElementById("pass-btn") as HTMLButtonElement | null,
      },
      onStonePlay: playStoneSound,
      onPass: playPassSound,
      onRender: (engine, territory) => {
        const { reviewing, finalized, score } = territory;
        updateControls(reviewing, finalized);

        const isBlackTurn = engine.current_turn_stone() === 1;

        let bStr: string;
        let wStr: string;
        if (score) {
          ({ bStr, wStr } = formatScoreStr(score, KOMI));
        } else {
          ({ bStr, wStr } = formatPoints(
            engine.captures_black(),
            engine.captures_white(),
            KOMI,
          ));
        }

        // White on top, black on bottom
        const whiteName = sgfMeta?.white_name ?? "White";
        const blackName = sgfMeta?.black_name ?? "Black";

        // Per-move time (BL/WL) if available, else static time settings
        const mtJson = engine.current_move_time();
        let bClock = "";
        let wClock = "";
        if (mtJson) {
          const mt = JSON.parse(mtJson);
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
          const fallback = formatSgfTime(sgfMeta?.time_limit_secs, sgfMeta?.overtime) ?? "";
          bClock = fallback;
          wClock = fallback;
        }

        if (playerTopEl) {
          setLabel(playerTopEl, {
            name: whiteName,
            captures: wStr,
            stone: "white",
            clock: wClock,
            isTurn: !reviewing && !finalized && !isBlackTurn,
          });
        }
        if (playerBottomEl) {
          setLabel(playerBottomEl, {
            name: blackName,
            captures: bStr,
            stone: "black",
            clock: bClock,
            isTurn: !reviewing && !finalized && isBlackTurn,
          });
        }
      },
    });

    // Wire territory buttons (re-wired on each initBoard since board changes)
    scoreBtn?.addEventListener("click", () => {
      board?.enterTerritoryReview();
    }, tOpts);
    readyBtn?.addEventListener("click", () => {
      board?.finalizeTerritoryReview();
    }, tOpts);
    exitBtn?.addEventListener("click", () => {
      board?.exitTerritoryReview();
    }, tOpts);

    // Restore move_times from saved SGF text (tree already restored via storageKey)
    if (sgfText && board) {
      board.engine.load_sgf_move_times(sgfText);
    }
  }

  if (sizeSelect) {
    sizeSelect.addEventListener("change", () => {
      const size = parseInt(sizeSelect.value, 10);
      currentSize = size;
      sgfMeta = undefined;
      sgfText = undefined;
      localStorage.removeItem(SGF_META_KEY);
      localStorage.removeItem(SGF_TEXT_KEY);
      localStorage.setItem(SIZE_KEY, String(size));
      initBoard(size);
    });
  }

  // --- SGF import ---
  const sgfImport = document.getElementById("sgf-import") as HTMLInputElement | null;
  sgfImport?.addEventListener("change", async () => {
    const file = sgfImport.files?.[0];
    if (!file) {
      return;
    }
    const text = await readFileAsText(file);
    const wasm = await ensureWasm();
    const metaJson = wasm.parse_sgf(text);
    const meta: SgfMeta = JSON.parse(metaJson);
    if (meta.error) {
      alert(`SGF error: ${meta.error}`);
      sgfImport.value = "";
      return;
    }
    if (meta.cols !== meta.rows) {
      alert("Non-square boards are not supported.");
      sgfImport.value = "";
      return;
    }
    const size = meta.cols;
    if (!VALID_SIZES.includes(size)) {
      alert(`Unsupported board size: ${size}×${size}`);
      sgfImport.value = "";
      return;
    }
    // Update size selector and current size
    currentSize = size;
    localStorage.setItem(SIZE_KEY, String(size));
    if (sizeSelect) {
      sizeSelect.value = String(size);
    }
    // Clear stored tree for this size so initBoard starts fresh
    localStorage.removeItem(`seki:analysis:tree:${size}`);
    localStorage.removeItem(`seki:analysis:tree:${size}:base`);
    localStorage.removeItem(`seki:analysis:tree:${size}:finalized`);
    localStorage.removeItem(`seki:analysis:tree:${size}:node`);
    sgfMeta = meta;
    sgfText = text;
    localStorage.setItem(SGF_META_KEY, JSON.stringify(meta));
    localStorage.setItem(SGF_TEXT_KEY, text);
    await initBoard(size);
    if (board) {
      board.engine.load_sgf_tree(text);
      board.engine.to_start();
      board.save();
      board.render();
    }
    sgfImport.value = "";
  });

  // --- SGF export ---
  const sgfExport = document.getElementById("sgf-export") as HTMLButtonElement | null;
  sgfExport?.addEventListener("click", () => {
    if (!board) {
      return;
    }
    const meta: SgfMeta = {
      cols: currentSize,
      rows: currentSize,
      komi: sgfMeta?.komi ?? KOMI,
      handicap: sgfMeta?.handicap,
      black_name: sgfMeta?.black_name,
      white_name: sgfMeta?.white_name,
      game_name: sgfMeta?.game_name,
      result: sgfMeta?.result,
      time_limit_secs: sgfMeta?.time_limit_secs,
      overtime: sgfMeta?.overtime,
    };
    const sgf = board.engine.export_sgf(JSON.stringify(meta));
    const filename = sgfMeta?.game_name
      ?? (sgfMeta?.black_name && sgfMeta?.white_name
        ? `${sgfMeta.black_name}-vs-${sgfMeta.white_name}`
        : "analysis");
    downloadSgf(sgf, `${filename}.sgf`);
  });

  initBoard(currentSize);
}
