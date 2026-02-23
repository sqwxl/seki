import { render, createRef } from "preact";
import { createBoard, ensureWasm } from "../goban/create-board";
import type { Board } from "../goban/create-board";
import type { ControlsProps } from "../components/controls";
import { readShowCoordinates } from "../utils/coord-toggle";
import {
  blackSymbol,
  whiteSymbol,
  formatPoints,
  formatSize,
  formatSgfTime,
  formatTime,
} from "../utils/format";
import { GamePageLayout } from "./game-page-layout";
import type { GamePageLayoutProps } from "./game-page-layout";
import { playStoneSound, playPassSound } from "../game/sound";
import { formatScoreStr } from "../game/ui";
import type { PlayerPanelProps } from "../components/player-panel";
import { createPremove } from "../utils/premove";
import {
  buildNavProps,
  buildCoordsToggle,
  buildMoveConfirmToggle,
} from "../utils/shared-controls";
import type { CoordsToggleState } from "../utils/shared-controls";
import { readFileAsText, downloadSgf } from "../utils/sgf";
import type { SgfMeta } from "../utils/sgf";
import type { Sign } from "../goban/types";

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

export function initAnalysis(root: HTMLElement) {
  const gobanRef = createRef<HTMLDivElement>();

  // Create move tree element for the sidebar slot
  const moveTreeEl = document.createElement("div");
  moveTreeEl.className = "move-tree";

  const savedSize = localStorage.getItem(SIZE_KEY);
  let currentSize = savedSize ? parseInt(savedSize, 10) : 19;
  if (!VALID_SIZES.includes(currentSize)) {
    currentSize = 19;
  }

  let board: Board | undefined;
  let sgfMeta: SgfMeta | undefined;
  let sgfText: string | undefined;

  // Restore saved SGF metadata and text
  const savedMeta = localStorage.getItem(SGF_META_KEY);
  if (savedMeta) {
    try {
      sgfMeta = JSON.parse(savedMeta);
    } catch {
      /* ignore */
    }
  }
  sgfText = localStorage.getItem(SGF_TEXT_KEY) ?? undefined;

  const coordsState: CoordsToggleState = {
    showCoordinates: readShowCoordinates(),
  };

  const pm = createPremove({
    getSign: () => (board?.engine.current_turn_stone() ?? 1) as Sign,
  });

  function ghostStone() {
    return pm.getGhostStone();
  }

  // Cached player panel props (updated in onRender)
  let playerTopProps: PlayerPanelProps | undefined;
  let playerBottomProps: PlayerPanelProps | undefined;

  // --- Build controls props ---
  function buildControls(): ControlsProps {
    const reviewing = board?.isTerritoryReview() ?? false;
    const finalized = board?.isFinalized() ?? false;

    const props: ControlsProps = {
      layout: "analysis",
      nav: buildNavProps(board),
      coordsToggle: buildCoordsToggle(board, coordsState),
      moveConfirmToggle: buildMoveConfirmToggle(pm, board),
      sizeSelect: {
        value: currentSize,
        options: VALID_SIZES,
        onChange: (size) => {
          currentSize = size;
          sgfMeta = undefined;
          sgfText = undefined;
          localStorage.removeItem(SGF_META_KEY);
          localStorage.removeItem(SGF_TEXT_KEY);
          localStorage.setItem(SIZE_KEY, String(size));
          initBoard(size);
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

    return props;
  }

  // --- Single render function ---
  function doRender() {
    const header = (
      <>
        <h2>Analysis Board</h2>
        {sgfMeta && <p>{formatSgfDescription(sgfMeta)}</p>}
      </>
    );

    const props: GamePageLayoutProps = {
      header,
      gobanRef,
      gobanStyle: `aspect-ratio: ${currentSize}/${currentSize}`,
      playerTop: playerTopProps,
      playerBottom: playerBottomProps,
      controls: buildControls(),
      sidebar: (
        <div
          ref={(el) => {
            if (el && !el.contains(moveTreeEl)) {
              el.appendChild(moveTreeEl);
            }
          }}
        />
      ),
    };

    render(<GamePageLayout {...props} />, root);
  }

  // --- Board initialization ---
  async function initBoard(size: number) {
    if (board) {
      board.destroy();
    }
    pm.clear();
    playerTopProps = undefined;
    playerBottomProps = undefined;

    // Render the layout first so the goban div exists
    doRender();

    board = await createBoard({
      cols: size,
      rows: size,
      showCoordinates: coordsState.showCoordinates,
      gobanEl: gobanRef.current!,
      komi: KOMI,
      moveTreeEl,
      moveTreeDirection: "responsive",
      storageKey: `seki:analysis:tree:${size}`,
      ghostStone,
      onVertexClick: (col, row) => {
        if (!pm.enabled) {
          return false;
        }
        if (pm.value && pm.value[0] === col && pm.value[1] === row) {
          pm.clear();
          doRender();
          return false; // let the board play the move
        }
        pm.value = [col, row];
        doRender();
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
          const fallback =
            formatSgfTime(sgfMeta?.time_limit_secs, sgfMeta?.overtime) ?? "";
          bClock = fallback;
          wClock = fallback;
        }

        playerTopProps = {
          name: whiteName,
          captures: wStr,
          stone: "white",
          clock: wClock,
          isTurn: !reviewing && !finalized && !isBlackTurn,
        };
        playerBottomProps = {
          name: blackName,
          captures: bStr,
          stone: "black",
          clock: bClock,
          isTurn: !reviewing && !finalized && isBlackTurn,
        };

        doRender();
      },
    });

    // Restore move_times from saved SGF text (tree already restored via storageKey)
    if (sgfText && board) {
      board.engine.load_sgf_move_times(sgfText);
    }
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
    // Update current size
    currentSize = size;
    localStorage.setItem(SIZE_KEY, String(size));
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
    const filename =
      sgfMeta?.game_name ??
      (sgfMeta?.black_name && sgfMeta?.white_name
        ? `${sgfMeta.black_name}-vs-${sgfMeta.white_name}`
        : "analysis");
    downloadSgf(sgf, `${filename}.sgf`);
  }

  initBoard(currentSize);
}
