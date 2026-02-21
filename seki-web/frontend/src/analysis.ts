import { createBoard, findNavButtons } from "./wasm-board";
import type { Board } from "./wasm-board";
import { setLabel } from "./game-ui";
import {
  blackSymbol,
  whiteSymbol,
  formatPoints,
} from "./format";
import { queryGameDom } from "./game-dom";

const SIZE_KEY = "seki:analysis:size";
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

  function updateControls(reviewing: boolean, finalized: boolean) {
    if (playControls) {
      playControls.style.display =
        reviewing ? "none" : "flex";
    }
    if (territoryControls) {
      territoryControls.style.display =
        reviewing ? "flex" : "none";
    }
    // When finalized, hide action buttons but keep nav visible
    if (finalized && playControls) {
      const scoreEl = playControls.querySelector("#score-btn");
      const passEl = playControls.querySelector("#pass-btn");
      const resetEl = playControls.querySelector("#reset-btn");
      if (scoreEl) {
        (scoreEl as HTMLElement).style.display = "none";
      }
      if (passEl) {
        (passEl as HTMLElement).style.display = "none";
      }
      if (resetEl) {
        (resetEl as HTMLElement).style.display = "none";
      }
    } else if (playControls) {
      const scoreEl = playControls.querySelector("#score-btn");
      const passEl = playControls.querySelector("#pass-btn");
      const resetEl = playControls.querySelector("#reset-btn");
      if (scoreEl) {
        (scoreEl as HTMLElement).style.display = "";
      }
      if (passEl) {
        (passEl as HTMLElement).style.display = "";
      }
      if (resetEl) {
        (resetEl as HTMLElement).style.display = "";
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
      gobanEl,
      komi: KOMI,
      moveTreeEl: document.getElementById("move-tree"),
      moveTreeDirection: "responsive",
      storageKey: `seki:analysis:tree:${size}`,
      navButtons: findNavButtons(),
      buttons: {
        pass: document.getElementById("pass-btn") as HTMLButtonElement | null,
        reset: document.getElementById("reset-btn") as HTMLButtonElement | null,
      },
      onRender: (engine, territory) => {
        const { reviewing, finalized, score } = territory;
        updateControls(reviewing, finalized);

        const isBlackTurn = engine.current_turn_stone() === 1;

        let bStr: string;
        let wStr: string;
        if (score) {
          const bTotal = score.black.territory + score.black.captures;
          const wTotal = score.white.territory + score.white.captures;
          ({ bStr, wStr } = formatPoints(bTotal, wTotal, KOMI));
        } else {
          ({ bStr, wStr } = formatPoints(
            engine.captures_black(),
            engine.captures_white(),
            KOMI,
          ));
        }

        // White on top, black on bottom
        if (playerTopEl) {
          setLabel(playerTopEl, {
            name: `${whiteSymbol()} White`,
            captures: wStr,
            isTurn: !reviewing && !finalized && !isBlackTurn,
          });
        }
        if (playerBottomEl) {
          setLabel(playerBottomEl, {
            name: `${blackSymbol()} Black`,
            captures: bStr,
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
  }

  if (sizeSelect) {
    sizeSelect.addEventListener("change", () => {
      const size = parseInt(sizeSelect.value, 10);
      currentSize = size;
      localStorage.setItem(SIZE_KEY, String(size));
      initBoard(size);
    });
  }

  initBoard(currentSize);
}
