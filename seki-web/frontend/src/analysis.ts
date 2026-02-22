import { createBoard, ensureWasm } from "./board";
import type { Board } from "./board";
import { readShowCoordinates, toggleShowCoordinates } from "./coord-toggle";
import { createPremove } from "./premove";
import { renderControls } from "./controls";
import type { ControlsProps } from "./controls";
import { formatScoreStr } from "./game-ui";
import { renderPlayerLabel } from "./player-label";
import {
  blackSymbol,
  whiteSymbol,
  formatPoints,
  formatSize,
  formatSgfTime,
  formatTime,
} from "./format";
import { queryGameDom } from "./game-dom";
import { playStoneSound, playPassSound } from "./game-sound";
import { readFileAsText, downloadSgf } from "./sgf-io";
import type { SgfMeta } from "./sgf-io";
import type { Sign } from "./goban/types";

const SIZE_KEY = "seki:analysis:size";
const SGF_META_KEY = "seki:analysis:sgfMeta";
const SGF_TEXT_KEY = "seki:analysis:sgfText";
const VALID_SIZES = [9, 13, 19];
const KOMI = 6.5;

function formatSgfDescription(meta: SgfMeta): string {
  const b = meta.black_name ?? "Black";
  const w = meta.white_name ?? "White";
  const parts: string[] = [
    `${b} ${blackSymbol()} vs ${w} ${whiteSymbol()}`,
    formatSize(meta.cols, meta.rows),
  ];
  if (meta.handicap && meta.handicap >= 2) {
    parts.push(`H${meta.handicap}`);
  }
  const tc = formatSgfTime(meta.time_limit_secs, meta.overtime);
  if (tc) {
    parts.push(tc);
  }
  if (meta.result) {
    parts.push(meta.result);
  }
  return parts.join(" - ");
}

function updateDescription(el: HTMLElement, meta: SgfMeta | undefined) {
  if (meta) {
    el.textContent = formatSgfDescription(meta);
    el.style.display = "";
  } else {
    el.textContent = "";
    el.style.display = "none";
  }
}

export function initAnalysis(_root: HTMLElement) {
  const {
    goban: gobanEl,
    controls: controlsEl,
    playerTop: playerTopEl,
    playerBottom: playerBottomEl,
  } = queryGameDom();
  const descriptionEl = document.getElementById("game-description")!;
  const sizeSelect = document.getElementById(
    "board-size",
  ) as HTMLSelectElement | null;

  const savedSize = localStorage.getItem(SIZE_KEY);
  let currentSize = savedSize ? parseInt(savedSize, 10) : 19;
  if (!VALID_SIZES.includes(currentSize)) {
    currentSize = 19;
  }
  if (sizeSelect) {
    sizeSelect.value = String(currentSize);
  }

  let board: Board | undefined;
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
  updateDescription(descriptionEl, sgfMeta);

  let showCoordinates = readShowCoordinates();

  const pm = createPremove({
    getSign: () => (board?.engine.current_turn_stone() ?? 1) as Sign,
  });

  function ghostStone() {
    return pm.getGhostStone();
  }

  // --- Controls rendering ---
  function doRenderControls() {
    if (!controlsEl) {
      return;
    }
    const reviewing = board?.isTerritoryReview() ?? false;
    const finalized = board?.isFinalized() ?? false;

    const props: ControlsProps = {
      layout: "analysis",
      nav: {
        atStart: board?.engine.is_at_start() ?? true,
        atLatest: board?.engine.is_at_latest() ?? true,
        counter: board
          ? `${board.engine.view_index()} / ${board.engine.total_moves()}`
          : "0 / 0",
        onNavigate: (action) => board?.navigate(action),
      },
      coordsToggle: {
        enabled: showCoordinates,
        onClick: () => {
          showCoordinates = toggleShowCoordinates();
          board?.setShowCoordinates(showCoordinates);
        },
      },
      moveConfirmToggle: {
        enabled: pm.enabled,
        onClick: () => {
          pm.enabled = !pm.enabled;
          pm.clear();
          board?.render();
        },
      },
    };

    if (reviewing) {
      props.territoryReady = {
        onClick: () => board?.finalizeTerritoryReview(),
      };
      props.territoryExit = {
        onClick: () => board?.exitTerritoryReview(),
      };
    } else if (!finalized) {
      props.pass = { onClick: () => board?.pass() };
      props.score = { onClick: () => board?.enterTerritoryReview() };
      props.sgfImport = { onFileChange: handleSgfImport };
      props.sgfExport = { onClick: handleSgfExport };
      // Still show territory controls wrapper so component knows this is analysis mode
      props.territoryReady = undefined;
      props.territoryExit = undefined;
    }

    if (pm.value) {
      props.confirmMove = {
        onClick: () => {
          if (pm.value && board) {
            const [col, row] = pm.value;
            pm.clear();
            if (board.engine.try_play(col, row)) {
              playStoneSound();
              board.save();
              board.render();
            }
          }
        },
      };
    }

    renderControls(controlsEl, props);
  }

  async function initBoard(size: number) {
    if (board) {
      board.destroy();
    }
    gobanEl.style.aspectRatio = `${size}/${size}`;
    pm.clear();

    board = await createBoard({
      cols: size,
      rows: size,
      showCoordinates,
      gobanEl,
      komi: KOMI,
      moveTreeEl: document.getElementById("move-tree"),
      moveTreeDirection: "responsive",
      storageKey: `seki:analysis:tree:${size}`,
      ghostStone,
      onVertexClick: (col, row) => {
        if (!pm.enabled) {
          return false;
        }
        if (pm.value && pm.value[0] === col && pm.value[1] === row) {
          pm.clear();
          doRenderControls();
          return false; // let the board play the move
        }
        pm.value = [col, row];
        doRenderControls();
        board?.render();
        return true; // consume the click
      },
      onStonePlay: () => {
        pm.clear();
        playStoneSound();
      },
      onPass: () => {
        pm.clear();
        playPassSound();
      },
      onRender: (engine, territory) => {
        const { reviewing, finalized, score } = territory;
        doRenderControls();

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
          renderPlayerLabel(playerTopEl, {
            name: whiteName,
            captures: wStr,
            stone: "white",
            clock: wClock,
            isTurn: !reviewing && !finalized && !isBlackTurn,
          });
        }
        if (playerBottomEl) {
          renderPlayerLabel(playerBottomEl, {
            name: blackName,
            captures: bStr,
            stone: "black",
            clock: bClock,
            isTurn: !reviewing && !finalized && isBlackTurn,
          });
        }
      },
    });

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
      updateDescription(descriptionEl, undefined);
      initBoard(size);
    });
  }

  // --- SGF import handler ---
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
    updateDescription(descriptionEl, sgfMeta);
    await initBoard(size);
    if (board) {
      board.engine.load_sgf_tree(text);
      board.engine.to_start();
      board.save();
      board.render();
    }
    input.value = "";
  }

  // --- SGF export handler ---
  function handleSgfExport() {
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
  }

  initBoard(currentSize);
}
