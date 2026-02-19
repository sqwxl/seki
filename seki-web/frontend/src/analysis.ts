import { createBoard, findNavButtons } from "./wasm-board";
import { setLabel } from "./game-ui";
import {
  blackCaptureSymbol,
  blackSymbol,
  whiteCaptureSymbol,
  whiteSymbol,
} from "./format";

const SIZE_KEY = "seki:analysis:size";
const VALID_SIZES = [9, 13, 19];

export function initAnalysis(root: HTMLElement) {
  const gobanEl = document.getElementById("goban")!;
  const playerTopEl = document.getElementById("player-top");
  const playerBottomEl = document.getElementById("player-bottom");
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

  let board: Awaited<ReturnType<typeof createBoard>> | undefined;

  async function initBoard(size: number) {
    if (board) {
      board.destroy();
    }
    gobanEl.style.aspectRatio = `${size}/${size}`;

    board = await createBoard({
      cols: size,
      rows: size,
      gobanEl,
      moveTreeEl: document.getElementById("move-tree"),
      storageKey: `seki:analysis:tree:${size}`,
      navButtons: findNavButtons(),
      buttons: {
        pass: document.getElementById("pass-btn") as HTMLButtonElement | null,
        reset: document.getElementById("reset-btn") as HTMLButtonElement | null,
      },
      onRender: (engine) => {
        const isBlackTurn = engine.current_turn_stone() === 1;
        // White on top, black on bottom
        if (playerTopEl) {
          setLabel(playerTopEl, {
            name: `${whiteSymbol()} White`,
            captures: `${engine.captures_white()} ${whiteCaptureSymbol()}`,
            isTurn: !isBlackTurn,
          });
        }
        if (playerBottomEl) {
          setLabel(playerBottomEl, {
            name: `${blackSymbol()} Black`,
            captures: `${engine.captures_black()} ${blackCaptureSymbol()}`,
            isTurn: isBlackTurn,
          });
        }
      },
    });
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
